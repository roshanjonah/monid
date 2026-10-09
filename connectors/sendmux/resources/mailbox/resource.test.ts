import { assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl } from "@std/path";
import type { OwnedResource } from "@shared/core";
import { loadFixture, loadResource, testResourceUnit } from "@shared/testing";

const HERE = fromFileUrl(new URL("../../", import.meta.url));
const ROW: OwnedResource = {
    resource: "sendmux/mailbox",
    externalId: "mbx_owned",
    data: { email: "agent@example.com" },
};

Deno.test("sendmux mailbox release treats repeated deletion as success", async () => {
    const resource = await loadResource({
        unit: await testResourceUnit("sendmux/mailbox"),
        mode: "replay",
        fixture: await loadFixture(
            `${HERE}fixtures/synthetic-release-twice.json`,
        ),
    });
    assertEquals(await resource.release(ROW), { released: true });
    assertEquals(await resource.release(ROW), { released: true });
});

const WINDOW = {
    startIso: "2026-09-01T00:00:00.000Z",
    endIso: "2026-09-02T00:00:00.000Z",
};

Deno.test("sendmux meter refuses pending cost instead of settling zero", async () => {
    const resource = await loadResource({
        unit: await testResourceUnit("sendmux/mailbox"),
        mode: "replay",
        fixture: await loadFixture(
            `${HERE}fixtures/synthetic-usage-pending.json`,
        ),
    });
    await assertRejects(
        () => resource.reconcileUsage("incoming", ROW, WINDOW),
        Error,
        "not final",
    );
});

Deno.test("sendmux meter returns posted cumulative lines on repeated and post-release reads", async () => {
    const resource = await loadResource({
        unit: await testResourceUnit("sendmux/mailbox"),
        mode: "replay",
        fixture: await loadFixture(
            `${HERE}fixtures/synthetic-usage-final.json`,
        ),
    });
    assertEquals(await resource.release(ROW), { released: true });
    assertEquals(await resource.reconcileUsage("incoming", ROW, WINDOW), {
        consumes: { credit: "default", amount: 0.0025 },
    });
    assertEquals(await resource.reconcileUsage("outgoing", ROW, WINDOW), {
        consumes: { credit: "default", amount: 0.004 },
    });
    assertEquals(await resource.reconcileUsage("storage", ROW, WINDOW), {
        consumes: { credit: "default", amount: 0.000125 },
    });
    assertEquals(await resource.reconcileUsage("incoming", ROW, WINDOW), {
        consumes: { credit: "default", amount: 0.0025 },
    });
});
