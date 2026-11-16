//! Message consumers as entry points (gap `consumers`): each form Bull, Bee-Queue,
//! kafkajs, amqplib, `sqs-consumer`, `nats` and `@nestjs/bullmq` document, in the
//! reading that lists it. What the last measured build listed stays in what mining
//! reads, under the same names; what is read since is in the listed reading only,
//! and a consumer whose handler Drift cannot read is said with its line.

use std::fs;
use std::path::Path;

use drift_core::{EntryPoint, FileFacts, RepoFacts, UnlistedReason, UnlistedRoute};
use drift_ts::{ScanOptions, scan};

fn repo(files: &[(&str, &str)]) -> RepoFacts {
    let dir = tempfile::tempdir().expect("tempdir");
    for (path, text) in files {
        let p = dir.path().join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
    scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .expect("scan")
    .0
}

fn file<'a>(r: &'a RepoFacts, path: &str) -> &'a FileFacts {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
}

fn rows(entries: &[EntryPoint]) -> Vec<String> {
    let mut out: Vec<String> = entries
        .iter()
        .map(|e| {
            format!(
                "{} {} {} {}",
                e.kind,
                e.adapter,
                e.symbol,
                e.route.as_deref().unwrap_or("-")
            )
        })
        .collect();
    out.sort();
    out
}

const HANDLERS: &str = r#"import { exec } from "child_process";
export async function sendEmail(job: any) { exec(job.data.cmd); }
"#;

/// Bull: a handler passed as an imported function, with a job name and a
/// concurrency, and a function written in place behind a concurrency, are what the
/// measured build listed (unchanged, in both readings). A handler bound to the
/// instance (`this.handle.bind(this)`) is listed since; a processor file path runs
/// in a process of its own and is said, not listed.
#[test]
fn bull_forms_are_listed_in_the_reading_that_reads_them() {
    let r = repo(&[
        ("src/handlers.ts", HANDLERS),
        (
            "src/bull.ts",
            r#"import Queue from "bull";
import { sendEmail } from "./handlers";
const emails = new Queue("emails");
emails.process(sendEmail);
emails.process("welcome", 5, sendEmail);
emails.process(3, async (job: any) => job.data);
emails.process("/app/processors/email.js");
export class Mailer {
  q = new Queue("mail");
  start() { this.q.process(this.handle.bind(this)); }
  async handle(job: any) { return job; }
}
"#,
        ),
    ]);
    let f = file(&r, "src/bull.ts");
    let measured = [
        "consumer bull CONSUMER emails #2 emails",
        "consumer bull CONSUMER emails emails",
        "consumer bull CONSUMER welcome welcome",
    ];
    assert_eq!(rows(&f.entry_points), measured);
    let mut listed: Vec<&str> = measured.to_vec();
    listed.push("consumer bull CONSUMER q q");
    listed.sort();
    assert_eq!(rows(f.listed_entry_points()), listed);
    assert_eq!(
        f.unlisted(),
        [UnlistedRoute {
            line: 7,
            reason: UnlistedReason::HandlerNotRead
        }]
    );
}

/// Bee-Queue, kafkajs (`eachMessage`, `eachBatch`) and amqplib are listed as the
/// measured build listed them, with the queue where it is written: nothing changes.
#[test]
fn bee_queue_kafkajs_and_amqplib_keep_their_listing() {
    let r = repo(&[
        ("src/handlers.ts", HANDLERS),
        (
            "src/bee.ts",
            "import BeeQueue from \"bee-queue\";\nimport { sendEmail } from \"./handlers\";\nconst orders = new BeeQueue(\"orders\");\norders.process(4, sendEmail);\n",
        ),
        (
            "src/kafka.ts",
            "import { Kafka } from \"kafkajs\";\nimport { sendEmail } from \"./handlers\";\nconst consumer = new Kafka({ brokers: [] }).consumer({ groupId: \"g\" });\nawait consumer.run({ eachMessage: sendEmail });\nconst batch = new Kafka({ brokers: [] }).consumer({ groupId: \"b\" });\nawait batch.run({ eachBatch: async ({ batch }: any) => batch });\n",
        ),
        (
            "src/amqp.ts",
            "import amqp from \"amqplib\";\nimport { sendEmail } from \"./handlers\";\nconst ch: any = await (await amqp.connect(\"x\")).createChannel();\nch.consume(\"orders\", sendEmail);\n",
        ),
    ]);
    let both = |p: &str| {
        let f = file(&r, p);
        assert_eq!(rows(&f.entry_points), rows(f.listed_entry_points()), "{p}");
        rows(&f.entry_points)
    };
    assert_eq!(both("src/bee.ts"), ["consumer bull CONSUMER orders orders"]);
    assert_eq!(
        both("src/kafka.ts"),
        [
            "consumer kafkajs CONSUMER batch batch",
            "consumer kafkajs CONSUMER consumer consumer"
        ]
    );
    assert_eq!(
        both("src/amqp.ts"),
        ["consumer amqplib CONSUMER orders orders"]
    );
}

/// `sqs-consumer` and `nats` consumers are listed since, by the queue URL and the
/// subject. A `nats` subscription read with `for await` hands no handler and is
/// said; so is an `sqs-consumer` handler that is no function or reference.
#[test]
fn sqs_consumer_and_nats_are_listed_since() {
    let r = repo(&[
        ("src/handlers.ts", HANDLERS),
        (
            "src/sqs.ts",
            r#"import { Consumer } from "sqs-consumer";
import { sendEmail } from "./handlers";
const handlers: any = {};
export const a = Consumer.create({ queueUrl: "https://sqs/q", handleMessage: sendEmail });
export const b = Consumer.create({ queueUrl: process.env.QUEUE_URL, handleMessageBatch: async (ms: any) => ms });
export const c = Consumer.create({ queueUrl: "https://sqs/x", handleMessage: handlers["x"] });
"#,
        ),
        (
            "src/nats.ts",
            r#"import { connect } from "nats";
const nc = await connect({ servers: "x" });
nc.subscribe("updates", { callback: (_err: any, msg: any) => msg });
const sub = nc.subscribe("events");
for await (const m of sub) { console.log(m); }
"#,
        ),
    ]);
    let sqs = file(&r, "src/sqs.ts");
    assert!(sqs.entry_points.is_empty());
    assert_eq!(
        rows(sqs.listed_entry_points()),
        [
            "consumer sqs-consumer CONSUMER ? ?",
            "consumer sqs-consumer CONSUMER https://sqs/q https://sqs/q"
        ]
    );
    assert_eq!(
        sqs.unlisted(),
        [UnlistedRoute {
            line: 6,
            reason: UnlistedReason::HandlerNotRead
        }]
    );
    let nats = file(&r, "src/nats.ts");
    assert!(nats.entry_points.is_empty());
    assert_eq!(
        rows(nats.listed_entry_points()),
        ["consumer nats CONSUMER updates updates"]
    );
    assert_eq!(
        nats.unlisted(),
        [UnlistedRoute {
            line: 4,
            reason: UnlistedReason::HandlerNotRead
        }]
    );
}

/// `process` of a `@Processor` class extending `WorkerHost` of `@nestjs/bullmq` is
/// a `job`, as `@Process` of `@nestjs/bull` is: listed since. A class of the same
/// shape whose base is not that package's is none.
#[test]
fn a_nestjs_bullmq_worker_host_is_a_job() {
    let r = repo(&[
        (
            "src/audio.processor.ts",
            r#"import { Processor, WorkerHost } from "@nestjs/bullmq";
@Processor("audio")
export class AudioProcessor extends WorkerHost {
  async process(job: any): Promise<void> { return job; }
}
"#,
        ),
        (
            "src/other.ts",
            r#"import { Processor } from "@nestjs/bullmq";
import { WorkerHost } from "./host";
@Processor("video")
export class VideoProcessor extends WorkerHost {
  async process(job: any): Promise<void> { return job; }
}
"#,
        ),
        ("src/host.ts", "export class WorkerHost {}\n"),
    ]);
    let f = file(&r, "src/audio.processor.ts");
    assert!(f.entry_points.is_empty());
    assert_eq!(
        rows(f.listed_entry_points()),
        ["job nestjs JOB AudioProcessor.process AudioProcessor.process"]
    );
    assert!(file(&r, "src/other.ts").listed_entry_points().is_empty());
}
