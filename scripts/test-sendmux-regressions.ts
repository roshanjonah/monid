import ts from "typescript";

const logDirectory = ".output/sendmux-regressions";
await Deno.mkdir(logDirectory, { recursive: true });
const originals = new Map<string, string>();

function propertyName(
    node: ts.PropertyAssignment,
    source: ts.SourceFile,
): string {
    return node.name.getText(source).replaceAll('"', "");
}

async function editSource(
    file: string,
    edits: (
        source: ts.SourceFile,
    ) => Array<{ start: number; end: number; text: string }>,
): Promise<void> {
    const original = await Deno.readTextFile(file);
    originals.set(file, original);
    const source = ts.createSourceFile(
        file,
        original,
        ts.ScriptTarget.Latest,
        true,
    );
    const replacements = edits(source);
    if (replacements.length === 0) {
        throw new Error(`No mutation sites in ${file}`);
    }
    let changed = original;
    for (const edit of replacements.sort((a, b) => b.start - a.start)) {
        changed = changed.slice(0, edit.start) + edit.text +
            changed.slice(edit.end);
    }
    await Deno.writeTextFile(file, changed);
}

async function removeEndpointBindings(): Promise<void> {
    for await (const entry of Deno.readDir("connectors/sendmux/endpoints")) {
        if (!entry.isDirectory) continue;
        await editSource(
            `connectors/sendmux/endpoints/${entry.name}/endpoint.ts`,
            (source) => {
                const edits: Array<
                    { start: number; end: number; text: string }
                > = [];
                function visit(node: ts.Node): void {
                    if (
                        ts.isPropertyAssignment(node) &&
                        propertyName(node, source) === "resources"
                    ) {
                        const end = node.end +
                            (source.text[node.end] === "," ? 1 : 0);
                        edits.push({
                            start: node.getStart(source),
                            end,
                            text: "",
                        });
                    }
                    ts.forEachChild(node, visit);
                }
                visit(source);
                return edits;
            },
        );
    }
}

async function replaceHookBodies(
    file: string,
    bodies: Record<string, string>,
): Promise<void> {
    await editSource(file, (source) => {
        const edits: Array<{ start: number; end: number; text: string }> = [];
        function visit(node: ts.Node): void {
            if (ts.isPropertyAssignment(node)) {
                const replacement = bodies[propertyName(node, source)];
                if (
                    replacement !== undefined &&
                    ts.isArrowFunction(node.initializer)
                ) {
                    const body = node.initializer.body;
                    edits.push({
                        start: body.getStart(source),
                        end: body.end,
                        text: replacement,
                    });
                }
            }
            ts.forEachChild(node, visit);
        }
        visit(source);
        return edits;
    });
}

async function dropStoreEffects(): Promise<void> {
    await editSource("scripts/store/kv.ts", (source) => {
        const edits: Array<{ start: number; end: number; text: string }> = [];
        for (const statement of source.statements) {
            if (
                ts.isFunctionDeclaration(statement) &&
                statement.name?.text === "persistEffects" && statement.body
            ) {
                edits.push({
                    start: statement.body.getStart(source),
                    end: statement.body.end,
                    text: "{}",
                });
            }
        }
        return edits;
    });
}

async function restore(): Promise<void> {
    for (const [file, original] of originals) {
        await Deno.writeTextFile(file, original);
    }
    originals.clear();
}

async function runTests(
    name: string,
    files: string[],
    expectedFailures: number,
    filter?: string,
): Promise<void> {
    const result = await new Deno.Command(Deno.execPath(), {
        args: [
            "test",
            "--unstable-kv",
            "--allow-read",
            "--allow-env",
            "--allow-write",
            ...(filter ? ["--filter", filter] : []),
            ...files,
        ],
        stdout: "piped",
        stderr: "piped",
        env: { NO_COLOR: "1" },
    }).output();
    const output = new TextDecoder().decode(result.stdout) +
        new TextDecoder().decode(result.stderr);
    await Deno.writeTextFile(`${logDirectory}/${name}.log`, output);
    const match = output.match(
        /(\d+) passed \| (\d+) failed(?: \| (\d+) ignored)?/,
    );
    if (!match) throw new Error(`${name}: no executed test summary; see log`);
    const passed = Number(match[1]);
    const failed = Number(match[2]);
    const ignored = Number(match[3] ?? 0);
    console.log(
        JSON.stringify({
            stage: name,
            exit: result.code,
            passed,
            failed,
            ignored,
        }),
    );
    if (
        ignored !== 0 || passed + failed === 0 ||
        (expectedFailures === 0
            ? result.code !== 0 || failed !== 0
            : result.code === 0 || failed < expectedFailures)
    ) {
        throw new Error(
            `${name}: expected ${
                expectedFailures ? "behavioural red" : "green"
            }; see log`,
        );
    }
}

const resourceFile = "connectors/sendmux/resources/mailbox/resource.ts";
try {
    await removeEndpointBindings();
    await runTests("red-ownership", [
        "connectors/sendmux/endpoint-contract.test.ts",
    ], 20);
} finally {
    await restore();
}
try {
    await dropStoreEffects();
    await runTests("red-persistence", [
        "connectors/sendmux/lifecycle-contract.test.ts",
    ], 2);
} finally {
    await restore();
}

for (
    const mutation of [
        {
            name: "verify",
            filter: "sendmux resource verify",
            failures: 1,
            body: "{ return { active: false }; }",
        },
        {
            name: "refresh",
            filter: "sendmux resource refresh",
            failures: 1,
            body: "{ return { active: false }; }",
        },
        {
            name: "release",
            filter: "sendmux resource release",
            failures: 1,
            body: "{ return { released: true }; }",
        },
        {
            name: "get",
            filter: "sendmux resource meter",
            failures: 4,
            body: '{ return { consumes: { credit: "default", amount: 0 } }; }',
        },
    ]
) {
    try {
        await replaceHookBodies(resourceFile, {
            [mutation.name]: mutation.body,
        });
        await runTests(
            `red-resource-${mutation.name}`,
            ["connectors/sendmux/resources/mailbox/resource.test.ts"],
            mutation.failures,
            mutation.filter,
        );
    } finally {
        await restore();
    }
}
try {
    await replaceHookBodies("connectors/sendmux/provider.ts", {
        route:
            '{ return { who: { kind: "unhandled", event: "unknown" }, what: { action: "ignore" } }; }',
    });
    await runTests(
        "red-event-route",
        ["connectors/sendmux/event-contract.test.ts"],
        1,
        "sendmux compiled webhook",
    );
} finally {
    await restore();
}
try {
    await editSource("connectors/sendmux/provider.ts", (source) => {
        const edits: Array<{ start: number; end: number; text: string }> = [];
        function visit(node: ts.Node): void {
            if (
                ts.isPropertyAssignment(node) &&
                propertyName(node, source) === "signaturePrefix"
            ) {
                edits.push({
                    start: node.initializer.getStart(source),
                    end: node.initializer.end,
                    text: '"sha256="',
                });
            }
            ts.forEachChild(node, visit);
        }
        visit(source);
        return edits;
    });
    await runTests(
        "red-event-signature",
        ["connectors/sendmux/event-contract.test.ts"],
        2,
        "sendmux event ",
    );
} finally {
    await restore();
}

await runTests("green-sendmux", ["connectors/sendmux"], 0);
