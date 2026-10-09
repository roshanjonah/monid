import { assertEquals } from "@std/assert";
import { copy, ensureDir } from "@std/fs";
import { fromFileUrl, join } from "@std/path";
import { KvResourceStore } from "./store/kv.ts";
import {
    signTimestampedWebhookBody,
    signWebhookBody,
} from "./fixtures/sendmux-gateway-webhook-signer.ts";

// Unmodified Sendmux/event-gateway producer source, bded1269f60f6bba4d154fcd36777f24fcec2f14:
// src/consumers/shared/webhook-signer.ts, git blob 35ca75d8b63b92be9f9a1ad4cef0ec816b1a35ed.
// Keep it byte-identical: the receiver must accept the producer's Node-crypto output.
const ROOT = fromFileUrl(new URL("../", import.meta.url));
const SECRET = "synthetic-webhook-secret";

function headers(body: string, timestamp = Math.floor(Date.now() / 1000)) {
    const [time, signature] = signTimestampedWebhookBody(
        body,
        SECRET,
        timestamp,
    ).split(",");
    return {
        "content-type": "application/json",
        "x-sendmux-signature": signWebhookBody(body, SECRET),
        "x-sendmux-timestamp": time.slice(2),
        "x-sendmux-signature-v2": signature,
        "x-sendmux-event-id": "evt_signature_acceptance",
    };
}

async function until(condition: () => boolean | Promise<boolean>) {
    const deadline = Date.now() + 10_000;
    while (!await condition()) {
        if (Date.now() >= deadline) {
            throw new Error("listener acceptance timed out");
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

function replaceOnce(source: string, before: string, after: string): string {
    if (source.split(before).length !== 2) {
        throw new Error(
            "fixture replacement must match exactly once: " + before,
        );
    }
    return source.replace(before, after);
}

Deno.test("Sendmux Gateway signatures gate the actual owned-inbox listener", async (test) => {
    const artifactRoot = join(ROOT, ".claude", "artifacts", "webhook-listener");
    await ensureDir(artifactRoot);
    const fixture = await Deno.makeTempDir({
        dir: artifactRoot,
        prefix: "receiver-",
    });
    const dbPath = join(fixture, ".output", "local.db");
    const requests: string[] = [];
    const upstream = Deno.serve({
        hostname: "127.0.0.1",
        port: 0,
        onListen() {},
    }, (request) => {
        requests.push(new URL(request.url).pathname);
        return Response.json({
            ok: true,
            data: { email: "refreshed@example.test" },
        });
    });
    let child: Deno.ChildProcess | undefined;
    let stderr = "";
    let drains: Promise<void>[] = [];
    try {
        for (
            const path of [
                "deno.json",
                "deno.lock",
                "config.yml",
                "connectors",
                "shared",
                "engine",
                "scripts",
            ]
        ) {
            await copy(join(ROOT, path), join(fixture, path));
        }
        const providerPath = join(
            fixture,
            "connectors",
            "sendmux",
            "provider.ts",
        );
        const provider = await Deno.readTextFile(providerPath);
        await Deno.writeTextFile(
            providerPath,
            replaceOnce(
                provider,
                "https://app.sendmux.ai/api/v1",
                `http://127.0.0.1:${upstream.addr.port}/api/v1`,
            ),
        );

        // Red receipts mutate only disposable copies; production sources stay intact.
        const mutation = Deno.env.get("MONID_SIGNATURE_MUTATION");
        const listenerPath = join(fixture, "scripts", "webhook.ts");
        let listener = await Deno.readTextFile(listenerPath);
        if (mutation === "signature") {
            listener = replaceOnce(
                listener,
                "if (!timingSafeEqual(expected, signature))",
                "if (false)",
            );
        } else if (mutation === "freshness") {
            listener = replaceOnce(
                listener,
                "if (!Number.isFinite(age) || age > verify.toleranceMs)",
                "if (false)",
            );
        } else if (mutation === "ownership") {
            listener = replaceOnce(
                listener,
                "const row = await store.get(",
                "let row = await store.get(",
            );
            listener = replaceOnce(
                listener,
                "if (row === undefined) {",
                'if (row === undefined) { row = { resource: what.target.resource, externalId: what.target.externalId, data: { email: "foreign@example.test" } }; }\n                if (false) {',
            );
        } else if (mutation !== undefined) {
            throw new Error("unknown signature protection mutation");
        }
        if (mutation !== undefined) {
            await Deno.writeTextFile(listenerPath, listener);
        }

        const seed = await KvResourceStore.open(dbPath);
        await seed.provision({
            resource: "sendmux/mailbox",
            externalId: "mbx_owned",
            data: { email: "original@example.test" },
        });
        seed.close();
        const reservation = Deno.listen({ hostname: "127.0.0.1", port: 0 });
        const port = (reservation.addr as Deno.NetAddr).port;
        reservation.close();
        child = new Deno.Command(Deno.execPath(), {
            cwd: fixture,
            args: [
                "run",
                "--unstable-kv",
                "--allow-read",
                "--allow-write",
                "--allow-env",
                "--allow-net=127.0.0.1,0.0.0.0",
                "scripts/webhook.ts",
                "listen",
                "sendmux",
                "--port",
                String(port),
                "--tunnel",
                "none",
                "--secret",
                SECRET,
                "--execute",
            ],
            clearEnv: true,
            env: {
                DENO_DIR: Deno.env.get("DENO_DIR") ??
                    join(fixture, "deno-cache"),
                SENDMUX_CREDENTIALS_API_KEY: "synthetic-account-key",
            },
            stdout: "piped",
            stderr: "piped",
        }).spawn();
        drains = [
            child.stdout.pipeThrough(new TextDecoderStream()).pipeTo(
                new WritableStream({
                    write() {},
                }),
            ),
            child.stderr.pipeThrough(new TextDecoderStream()).pipeTo(
                new WritableStream({
                    write(value) {
                        stderr += value;
                    },
                }),
            ),
        ];
        await until(() => stderr.includes("Listening on"));
        const url =
            `http://127.0.0.1:${port}/v1/providers/sendmux/account/mailbox-events`;
        const raw =
            '{ "id": "evt_signature_acceptance", "type": "message.received", "data": { "mailbox_id": "mbx_owned" }, "note": "Exact bytes — 日本語" }\n';
        const post = async (body: string, signed: Record<string, string>) => {
            const response = await fetch(url, {
                method: "POST",
                headers: signed,
                body,
            });
            await response.text();
            return response.status;
        };
        const owned = async () => {
            const store = await KvResourceStore.open(dbPath);
            try {
                return await store.get("sendmux/mailbox", "mbx_owned");
            } finally {
                store.close();
            }
        };

        const baselinePassed =
            await test.step("Gateway-produced Unicode and whitespace bytes refresh the owned inbox", async () => {
                assertEquals(await post(raw, headers(raw)), 200);
                await until(() =>
                    requests.length === 1 && stderr.includes("patch persisted")
                );
                assertEquals(requests, ["/api/v1/mailboxes/mbx_owned"]);
                assertEquals((await owned())?.data, {
                    email: "refreshed@example.test",
                });
            });
        assertEquals(baselinePassed, true);
        await test.step("altered exact bytes are denied before refresh", async () => {
            const before = await owned();
            assertEquals(await post(raw + " ", headers(raw)), 401);
            assertEquals(requests.length, 1);
            assertEquals(await owned(), before);
        });
        await test.step("expired Gateway signatures are denied before refresh", async () => {
            const before = await owned();
            assertEquals(
                await post(
                    raw,
                    headers(raw, Math.floor(Date.now() / 1000) - 301),
                ),
                401,
            );
            assertEquals(requests.length, 1);
            assertEquals(await owned(), before);
        });
        await test.step("a signed foreign inbox event never refreshes or creates ownership", async () => {
            const before = await owned();
            const foreign = raw.replace("mbx_owned", "mbx_foreign");
            assertEquals(await post(foreign, headers(foreign)), 200);
            await until(() =>
                stderr.includes('"mbx_foreign" not owned locally') ||
                requests.length > 1 || stderr.includes("execute failed")
            );
            assertEquals(requests.length, 1);
            assertEquals(await owned(), before);
            const store = await KvResourceStore.open(dbPath);
            try {
                assertEquals(
                    await store.get("sendmux/mailbox", "mbx_foreign"),
                    undefined,
                );
            } finally {
                store.close();
            }
        });
    } catch (error) {
        console.error(stderr.slice(-8_000));
        throw error;
    } finally {
        if (child !== undefined) {
            child.kill("SIGINT");
            await child.status;
            await Promise.all(drains);
        }
        await upstream.shutdown();
        await Deno.remove(fixture, { recursive: true });
    }
});
