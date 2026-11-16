//! Message consumers through the CLI (gap `consumers`): `drift security --json`
//! lists each consumer a library's documented call or base registers, with its
//! kind, its queue or topic where it is a literal, and what its handler reaches;
//! `drift practices --json --units` lists it among the consumers. What Drift cannot
//! tie to a library or to a handler it reads is not listed and is named, with its
//! line and why (`unlisted`), never silently dropped.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

fn json(root: &Path, args: &[&str]) -> Value {
    serde_json::from_str(&drift(root, args)).unwrap()
}

/// `path symbol kind route [what it reaches]` of each entry point of `kind`.
fn entries(inv: &Value, kind: &str) -> Vec<String> {
    let mut out: Vec<String> = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["kind"] == kind)
        .map(|e| {
            let reaches: Vec<&str> = e["reaches"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| r["kind"].as_str().unwrap())
                .collect();
            format!(
                "{} {} {} {} [{}]",
                e["path"].as_str().unwrap(),
                e["symbol"].as_str().unwrap(),
                e["kind"].as_str().unwrap(),
                e["route"].as_str().unwrap_or("-"),
                reaches.join(",")
            )
        })
        .collect();
    out.sort();
    out
}

fn unlisted(inv: &Value) -> Vec<String> {
    let mut out: Vec<String> = inv["unlisted"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|u| {
            format!(
                "{}:{} {}",
                u["path"].as_str().unwrap(),
                u["line"],
                u["reason"].as_str().unwrap()
            )
        })
        .collect();
    out.sort();
    out
}

fn consumers(practices: &Value) -> Vec<String> {
    let mut out: Vec<String> = practices["consumers"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|c| {
            format!(
                "{} {} {}",
                c["path"].as_str().unwrap(),
                c["symbol"].as_str().unwrap(),
                c["adapter"].as_str().unwrap()
            )
        })
        .collect();
    out.sort();
    out
}

/// Python: a kombu callback imported from another file is listed where it is
/// defined, with its queue, and reaches the shell command its body runs; an
/// aio_pika handler bound to the class, pika and faust are listed with their queue
/// and topic. A class only named for a consumer, a lambda callback and a parameter
/// handed to `consume` are named under `unlisted`, each with its reason.
#[test]
fn python_consumers_are_listed_by_their_library() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"kombu\", \"aio-pika\", \"pika\", \"faust\"]\n",
    );
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/handlers.py",
        "import subprocess\n\n\ndef on_order(body, message):\n    subprocess.run(body[\"cmd\"], shell=True)\n    message.ack()\n",
    );
    write(
        r,
        "app/worker.py",
        "from kombu import Connection, Consumer, Queue\n\nfrom app.handlers import on_order\n\n\ndef run():\n    with Connection(\"amqp://\") as conn:\n        with Consumer(conn, queues=[Queue(\"orders\")], callbacks=[on_order]):\n            conn.drain_events()\n        with Consumer(conn, queues=[Queue(\"audit\")], callbacks=[lambda b, m: m.ack()]):\n            conn.drain_events()\n",
    );
    write(
        r,
        "app/aio.py",
        "import aio_pika\n\n\nclass Intake:\n    async def start(self, callback):\n        channel = await (await aio_pika.connect_robust(\"amqp://\")).channel()\n        queue = await channel.declare_queue(\"intake\")\n        await queue.consume(self.on_message)\n        await queue.consume(callback)\n\n    async def on_message(self, message):\n        return message.body\n",
    );
    write(
        r,
        "app/blocking.py",
        "import pika\n\n\ndef on_message(channel, method, properties, body):\n    return body\n\n\ndef main():\n    channel = pika.BlockingConnection(pika.ConnectionParameters(\"localhost\")).channel()\n    channel.basic_consume(queue=\"emails\", on_message_callback=on_message)\n",
    );
    write(
        r,
        "app/stream.py",
        "import faust\n\napp = faust.App(\"svc\")\norders = app.topic(\"orders\")\n\n\n@app.agent(orders)\nasync def process_orders(stream):\n    async for order in stream:\n        print(order)\n",
    );
    write(
        r,
        "app/base.py",
        "class BaseQueueConsumer:\n    def handle(self, msg):\n        raise NotImplementedError\n",
    );
    write(
        r,
        "app/named.py",
        "from app.base import BaseQueueConsumer\n\n\nclass EmailConsumer(BaseQueueConsumer):\n    def handle(self, msg):\n        return msg\n",
    );
    let inv = json(r, &["--no-cache", "security", "--json"]);
    assert_eq!(
        entries(&inv, "consumer"),
        [
            "app/aio.py Intake consumer intake []",
            "app/blocking.py on_message consumer emails []",
            "app/handlers.py on_order consumer orders [shell_exec]",
            "app/stream.py process_orders consumer orders []",
        ]
    );
    assert_eq!(
        unlisted(&inv),
        [
            "app/aio.py:9 handler_not_read",
            "app/named.py:4 named_only",
            "app/worker.py:10 handler_not_read",
        ]
    );
    let practices = json(r, &["--no-cache", "practices", "--json", "--units"]);
    assert_eq!(
        consumers(&practices),
        [
            "app/aio.py Intake aio_pika",
            "app/blocking.py on_message pika",
            "app/handlers.py on_order kombu",
            "app/stream.py process_orders faust",
        ]
    );
    let text = drift(r, &["--no-cache", "security"]);
    assert!(text.contains("named as a consumer only"), "{text}");
}

/// TypeScript: a Bull handler passed as an imported function and one bound to the
/// instance (`this.handle.bind(this)`) reach what their bodies run; an
/// `sqs-consumer` handler and a `nats` callback are listed by queue and subject; a
/// `WorkerHost` of `@nestjs/bullmq` is a `job`. A processor file path given to Bull
/// is named under `unlisted` as a handler not read.
#[test]
fn typescript_consumers_are_listed_with_what_they_reach() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{"name":"w","version":"1.0.0","dependencies":{"bull":"4.0.0","sqs-consumer":"7.0.0","nats":"2.0.0","@nestjs/bullmq":"10.0.0"}}"#,
    );
    write(
        r,
        "src/handlers.ts",
        "import { exec } from \"child_process\";\nexport async function sendEmail(job: any) { exec(job.data.cmd); }\n",
    );
    write(
        r,
        "src/bull.ts",
        r#"import Queue from "bull";
import { exec } from "child_process";
import { sendEmail } from "./handlers";
const emails = new Queue("emails");
emails.process("welcome", 5, sendEmail);
emails.process("/app/processors/email.js");
export class Mailer {
  q = new Queue("mail");
  start() { this.q.process(this.handle.bind(this)); }
  async handle(job: any) { exec(job.data.cmd); }
}
"#,
    );
    write(
        r,
        "src/sqs.ts",
        "import { Consumer } from \"sqs-consumer\";\nimport { sendEmail } from \"./handlers\";\nexport const app = Consumer.create({ queueUrl: \"https://sqs/q\", handleMessage: sendEmail });\n",
    );
    write(
        r,
        "src/nats.ts",
        "import { connect } from \"nats\";\nimport { sendEmail } from \"./handlers\";\nconst nc = await connect({ servers: \"x\" });\nnc.subscribe(\"updates\", { callback: (_e: any, m: any) => sendEmail(m) });\n",
    );
    write(
        r,
        "src/audio.processor.ts",
        "import { Processor, WorkerHost } from \"@nestjs/bullmq\";\nimport { exec } from \"child_process\";\n@Processor(\"audio\")\nexport class AudioProcessor extends WorkerHost {\n  async process(job: any): Promise<void> { exec(job.data.cmd); }\n}\n",
    );
    let inv = json(r, &["--no-cache", "security", "--json"]);
    assert_eq!(
        entries(&inv, "consumer"),
        [
            "src/bull.ts CONSUMER q consumer q [shell_exec]",
            "src/bull.ts CONSUMER welcome consumer welcome [shell_exec]",
            "src/nats.ts CONSUMER updates consumer updates [shell_exec]",
            "src/sqs.ts CONSUMER https://sqs/q consumer https://sqs/q [shell_exec]",
        ]
    );
    assert_eq!(
        entries(&inv, "job"),
        [
            "src/audio.processor.ts JOB AudioProcessor.process job AudioProcessor.process [shell_exec]"
        ]
    );
    assert_eq!(unlisted(&inv), ["src/bull.ts:6 handler_not_read"]);
    let practices = json(r, &["--no-cache", "practices", "--json", "--units"]);
    assert_eq!(
        consumers(&practices),
        [
            "src/bull.ts CONSUMER q bull",
            "src/bull.ts CONSUMER welcome bull",
            "src/nats.ts CONSUMER updates nats",
            "src/sqs.ts CONSUMER https://sqs/q sqs-consumer",
        ]
    );
}
