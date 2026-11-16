//! Message consumers as entry points (gap `consumers`): what Python lists as a
//! `consumer`, decided by the library a call or a base resolves to through imports,
//! never by a name. What the last measured build listed stays in what mining reads;
//! the rest is in the listed reading only, and what is not listed is said with its
//! line and why.

use std::path::Path;

use drift_core::{EntryPoint, FileFacts, RepoFacts, UnlistedReason, UnlistedRoute};
use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn scan_at(root: &Path) -> RepoFacts {
    scan(
        root,
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
                e.symbol,
                e.kind,
                e.adapter,
                e.route.as_deref().unwrap_or("-")
            )
        })
        .collect();
    out.sort();
    out
}

fn unread(line: u32) -> UnlistedRoute {
    UnlistedRoute {
        line,
        reason: UnlistedReason::HandlerNotRead,
    }
}

const PYPROJECT: &str = "[project]\nname = \"svc\"\ndependencies = [\"kombu\", \"aio-pika\", \"pika\", \"faust\", \"rq\"]\n";

const HANDLERS: &str = "import subprocess\n\n\ndef on_order(body, message):\n    subprocess.run(body[\"cmd\"], shell=True)\n    message.ack()\n";

/// A base only its name says is a consumer (`BaseQueueConsumer`, with `handle`) was
/// listed by name, as `queue`: mining still reads it so (frozen), the listed reading
/// does not list it and says it with its line (`named_only`). A subclass of kombu's
/// `ConsumerMixin`, resolved through the import, is listed in both readings.
#[test]
fn a_consumer_by_name_only_is_said_not_listed() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
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
    write(
        r,
        "app/mixin.py",
        "from kombu.mixins import ConsumerMixin\n\n\nclass Worker(ConsumerMixin):\n    def __init__(self, connection):\n        self.connection = connection\n",
    );
    let repo = scan_at(r);
    let named = file(&repo, "app/named.py");
    assert_eq!(
        rows(&named.entry_points),
        ["EmailConsumer consumer queue -"]
    );
    assert!(named.listed_entry_points().is_empty());
    assert_eq!(
        named.unlisted(),
        [UnlistedRoute {
            line: 4,
            reason: UnlistedReason::NamedOnly
        }]
    );
    let mixin = file(&repo, "app/mixin.py");
    assert_eq!(rows(&mixin.entry_points), ["Worker consumer kombu -"]);
    assert_eq!(
        rows(mixin.listed_entry_points()),
        ["Worker consumer kombu -"]
    );
    assert!(mixin.unlisted().is_empty());
}

/// kombu: `Consumer(..., queues=[Queue("orders")], callbacks=[on_order])` lists the
/// imported handler in the file that defines it, named by its queue; in
/// `get_consumers` of a `ConsumerMixin`, `callbacks=[self.on_task]` lists the class
/// once, with its queue. A lambda handler is said, not listed. All listed since.
#[test]
fn kombu_consumers_and_their_callbacks() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(r, "app/handlers.py", HANDLERS);
    write(
        r,
        "app/worker.py",
        r#"from kombu import Connection, Consumer, Queue
from kombu.mixins import ConsumerMixin

from app.handlers import on_order


class Worker(ConsumerMixin):
    def get_consumers(self, Consumer, channel):
        return [Consumer(queues=[Queue("tasks")], callbacks=[self.on_task])]

    def on_task(self, body, message):
        message.ack()


def run():
    with Connection("amqp://") as conn:
        with Consumer(conn, queues=[Queue("orders")], callbacks=[on_order]):
            conn.drain_events()
        with Consumer(conn, queues=[Queue("audit")], callbacks=[lambda b, m: m.ack()]):
            conn.drain_events()
"#,
    );
    let repo = scan_at(r);
    let handlers = file(&repo, "app/handlers.py");
    assert!(handlers.entry_points.is_empty());
    assert_eq!(
        rows(handlers.listed_entry_points()),
        ["on_order consumer kombu orders"]
    );
    let worker = file(&repo, "app/worker.py");
    assert_eq!(rows(&worker.entry_points), ["Worker consumer kombu -"]);
    assert_eq!(
        rows(worker.listed_entry_points()),
        ["Worker consumer kombu tasks"]
    );
    assert_eq!(worker.unlisted(), [unread(19)]);
}

/// aio_pika `queue.consume(handler)`, named by the queue `declare_queue` gave it;
/// `self.on_message` in a class lists the class. A handler that is a parameter is
/// not a function Drift can resolve: said, not listed. pika `basic_consume` and a
/// faust agent of the module's `faust.App` are listed with their queue and topic.
#[test]
fn aio_pika_pika_and_faust_consumers() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/aio.py",
        r#"import aio_pika


async def handle(message):
    return message.body


class Intake:
    async def start(self):
        connection = await aio_pika.connect_robust("amqp://")
        channel = await connection.channel()
        queue = await channel.declare_queue("intake")
        await queue.consume(self.on_message)

    async def on_message(self, message):
        return message.body


async def main(callback):
    connection = await aio_pika.connect_robust("amqp://")
    channel = await connection.channel()
    queue = await channel.declare_queue("orders")
    await queue.consume(handle)
    other = await channel.declare_queue("other")
    await other.consume(callback)
"#,
    );
    write(
        r,
        "app/blocking.py",
        "import pika\n\n\ndef on_message(channel, method, properties, body):\n    return body\n\n\ndef main():\n    channel = pika.BlockingConnection(pika.ConnectionParameters(\"localhost\")).channel()\n    channel.basic_consume(queue=\"emails\", on_message_callback=on_message)\n    channel.start_consuming()\n",
    );
    write(
        r,
        "app/stream.py",
        "import faust\n\napp = faust.App(\"svc\", broker=\"kafka://localhost\")\norders = app.topic(\"orders\")\n\n\n@app.agent(orders)\nasync def process_orders(stream):\n    async for order in stream:\n        print(order)\n",
    );
    let repo = scan_at(r);
    let aio = file(&repo, "app/aio.py");
    assert!(aio.entry_points.is_empty());
    assert_eq!(
        rows(aio.listed_entry_points()),
        [
            "Intake consumer aio_pika intake",
            "handle consumer aio_pika orders"
        ]
    );
    assert_eq!(aio.unlisted(), [unread(25)]);
    assert_eq!(
        rows(file(&repo, "app/blocking.py").listed_entry_points()),
        ["on_message consumer pika emails"]
    );
    let stream = file(&repo, "app/stream.py");
    assert!(stream.entry_points.is_empty());
    assert_eq!(
        rows(stream.listed_entry_points()),
        ["process_orders consumer faust orders"]
    );
}

/// An rq job is a `consumer` in both readings, as the measured build listed it
/// (kind kept: changing it would change what mining reads).
#[test]
fn an_rq_job_stays_a_consumer() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/jobs.py",
        "from rq.decorators import job\n\n\n@job(\"default\")\ndef send(address):\n    return address\n",
    );
    let repo = scan_at(r);
    let jobs = file(&repo, "app/jobs.py");
    assert_eq!(rows(&jobs.entry_points), ["send consumer rq -"]);
    assert_eq!(rows(jobs.listed_entry_points()), ["send consumer rq -"]);
}
