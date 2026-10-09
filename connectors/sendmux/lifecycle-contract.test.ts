import { assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { directTransport, Engine } from "@monid/connector-engine";
import {
    loadFixture,
    loadResource,
    replayFetch,
    testResourceUnit,
    testSealedUnit,
} from "@shared/testing";
import { KvResourceStore, persistEffects } from "../../scripts/store/kv.ts";

const HERE = fromFileUrl(new URL("./", import.meta.url));
const ROW = {
    resource: "sendmux/mailbox",
    externalId: "mbx_owned",
    data: { email: "agent@example.com" },
};
const WINDOW = {
    startIso: "2026-09-01T00:00:00.000Z",
    endIso: "2026-09-02T00:00:00.000Z",
};

Deno.test("sendmux local lifecycle persists one provision across store reopen", async () => {
    await Deno.mkdir(".output", { recursive: true });
    const directory = await Deno.makeTempDir({
        dir: ".output",
        prefix: "monid-row06-provision-",
    });
    const database = join(directory, "owned.db");
    let store = await KvResourceStore.open(database);
    try {
        const unit = await testSealedUnit("sendmux#mailboxes");
        const engine = new Engine({
            transport: directTransport({
                params: () => Promise.resolve({ apiKey: "test-key" }),
                fetch: replayFetch(
                    await loadFixture(
                        join(HERE, "fixtures/synthetic-create-mailbox.json"),
                    ),
                    {
                        "request.origin": "https://app.sendmux.ai",
                        "request.url":
                            "https://app.sendmux.ai/api/v1/mailboxes",
                    },
                ),
            }),
            resources: store,
        });
        const loaded = await engine.load(unit);
        const result = await loaded.start(
            { body: { email: ROW.data.email } },
            { runId: "row06-provision" },
        );
        assertEquals(result.kind, "COMPLETED");
        if (result.kind !== "COMPLETED") {
            throw new Error("Provision incomplete");
        }
        assertEquals(result.httpStatus, 201);
        await persistEffects(store, result.resources, () => {});
        assertEquals(await store.get(ROW.resource, ROW.externalId), ROW);
        store.close();
        store = await KvResourceStore.open(database);
        assertEquals(await store.list(), [ROW]);
        assertEquals(
            (result.output as Record<string, unknown>).credential,
            undefined,
        );
    } finally {
        store.close();
        await Deno.remove(directory, { recursive: true });
        await assertRejects(() => Deno.stat(directory), Deno.errors.NotFound);
    }
});

Deno.test("sendmux local lifecycle blocks released actions and retains the final meter row", async () => {
    await Deno.mkdir(".output", { recursive: true });
    const directory = await Deno.makeTempDir({
        dir: ".output",
        prefix: "monid-row06-release-",
    });
    const store = await KvResourceStore.open(join(directory, "owned.db"));
    try {
        await store.provision(ROW);
        const engine = new Engine({
            transport: directTransport({
                params: () => Promise.resolve({ apiKey: "test-key" }),
                fetch: () =>
                    Promise.reject(new Error("Action reached upstream")),
            }),
            resources: store,
        });
        const release = await engine.load(
            await testSealedUnit("sendmux#release-mailbox"),
        );
        const requested = await release.run({
            body: { public_id: ROW.externalId },
        });
        assertEquals(requested.httpStatus, 202);
        const retained = await store.get(ROW.resource, ROW.externalId);
        assertEquals(retained, ROW);
        if (!retained) throw new Error("Missing authorised row");
        await persistEffects(store, requested.resources, () => {});
        assertEquals(await store.owned({ resource: ROW.resource }), []);
        const read = await engine.load(
            await testSealedUnit("sendmux#mailboxes/{public_id}"),
        );
        const blocked = await read.run({
            pathParams: { public_id: ROW.externalId },
        });
        assertEquals(blocked.httpStatus, 404);
        assertEquals(blocked.usage.credits, {});
        assertEquals(
            (await release.run({ body: { public_id: ROW.externalId } }))
                .httpStatus,
            404,
        );

        const resource = await loadResource({
            unit: await testResourceUnit(ROW.resource),
            mode: "replay",
            fixture: await loadFixture(
                join(HERE, "fixtures/synthetic-usage-final.json"),
            ),
        });
        assertEquals(await resource.release(retained), { released: true });
        for (
            const [line, amount] of [
                ["incoming", 0.0025],
                ["outgoing", 0.004],
                ["storage", 0.000125],
                ["incoming", 0.0025],
            ] as const
        ) {
            assertEquals(
                await resource.reconcileUsage(line, retained, WINDOW),
                {
                    consumes: { credit: "default", amount },
                },
            );
        }
        assertEquals(await store.get(ROW.resource, ROW.externalId), undefined);
    } finally {
        store.close();
        await Deno.remove(directory, { recursive: true });
        await assertRejects(() => Deno.stat(directory), Deno.errors.NotFound);
    }
});
