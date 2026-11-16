//! Rows given whole where another class withholds a field of them (Python,
//! lowering 72).
//!
//! In Python the fields are chosen by a class beside the body. A class over a
//! model that takes the whole of it (`fields = "__all__"`, or `exclude` and so
//! everything else) is listed where another class of the same kind over the same
//! model withholds a field (`exclude`, a field of the model declared
//! `write_only`). A route whose declared response is the class its rows are read
//! of (`response_model=User`, `-> User`) is listed where another route's declared
//! response is that class with fields left out.
//!
//! Not listed: a class that names its fields, a class of another kind (a form
//! says nothing of what a serializer gives), a field a serializer declares for
//! input that is none of the model's, a field the table itself never gives back
//! (`Field(exclude=True)`), and a response that is no part of the table.

use std::collections::BTreeMap;
use std::process::Command;
use std::sync::LazyLock;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: LazyLock<String> = LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

const DJANGO_REQUIREMENTS: &str = r#"django==5.0.6
djangorestframework==3.15.1
"#;

const MANAGE: &str = r#"import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "shop.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)
"#;

const MODELS: &str = r#"from django.db import models


class Audited(models.Model):
    created_by = models.CharField(max_length=64)

    class Meta:
        abstract = True


class Account(Audited):
    email = models.EmailField()
    password = models.CharField(max_length=128)
    api_key = models.CharField(max_length=64)
    display_name = models.CharField(max_length=64)


class Order(models.Model):
    account = models.ForeignKey(Account, on_delete=models.CASCADE)
    total = models.IntegerField()
    note = models.TextField()
"#;

const SERIALIZERS: &str = r#"from rest_framework import serializers

from .models import Account, Order


class AccountPublicSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        exclude = ["api_key"]
        extra_kwargs = {"password": {"write_only": True}}


class AccountSignupSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)
    invite_code = serializers.CharField(write_only=True)

    class Meta:
        model = Account
        fields = ["email", "password", "invite_code"]


class AccountAdminSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = "__all__"


class AccountExportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        exclude = ["password"]


class AccountListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = ["id", "display_name"]


class OrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = Order
        fields = "__all__"
"#;

const FORMS: &str = r#"from django import forms

from .models import Account, Order


class AccountForm(forms.ModelForm):
    class Meta:
        model = Account
        fields = "__all__"


class OrderForm(forms.ModelForm):
    class Meta:
        model = Order
        exclude = ["note"]
"#;

const FASTAPI_REQUIREMENTS: &str = r#"fastapi==0.111.0
sqlmodel==0.0.19
"#;

const TABLES: &str = r#"from pydantic import BaseModel
from sqlmodel import Field, SQLModel


class UserBase(SQLModel):
    email: str
    full_name: str | None = None


class User(UserBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    hashed_password: str
    reset_token: str | None = None


class UserPublic(UserBase):
    id: int


class Team(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    billing_secret: str


class TeamOut(BaseModel):
    id: int
    name: str


class Device(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    label: str
    pairing_code: str = Field(exclude=True)


class DeviceOut(BaseModel):
    id: int
    label: str


class Note(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    body: str


class Message(SQLModel):
    message: str
"#;

const DB: &str = r#"from sqlmodel import Session, create_engine

engine = create_engine("sqlite://")


def get_session():
    with Session(engine) as session:
        yield session
"#;

const ROUTES: &str = r#"from fastapi import Depends, FastAPI
from sqlmodel import Session, select

from .db import get_session
from .models import (
    Device,
    DeviceOut,
    Message,
    Note,
    Team,
    TeamOut,
    User,
    UserPublic,
)

app = FastAPI()


@app.get("/users/{user_id}", response_model=UserPublic)
def read_user(user_id: int, session: Session = Depends(get_session)):
    return session.get(User, user_id)


@app.get("/admin/users/{user_id}", response_model=User)
def read_user_raw(user_id: int, session: Session = Depends(get_session)):
    return session.get(User, user_id)


@app.get("/admin/users", response_model=list[User])
def list_users_raw(session: Session = Depends(get_session)):
    return session.exec(select(User)).all()


@app.get("/users/by-email/{email}")
def find_user(email: str, session: Session = Depends(get_session)) -> User:
    return session.exec(select(User).where(User.email == email)).first()


@app.get("/teams/{team_id}", response_model=TeamOut)
def read_team(team_id: int, session: Session = Depends(get_session)):
    return session.get(Team, team_id)


@app.get("/admin/teams/{team_id}", response_model=Team)
def read_team_raw(team_id: int, session: Session = Depends(get_session)):
    return session.get(Team, team_id)


@app.get("/devices/{device_id}", response_model=DeviceOut)
def read_device(device_id: int, session: Session = Depends(get_session)):
    return session.get(Device, device_id)


@app.get("/admin/devices/{device_id}", response_model=Device)
def read_device_raw(device_id: int, session: Session = Depends(get_session)):
    return session.get(Device, device_id)


@app.get("/notes/{note_id}", response_model=Note)
def read_note(note_id: int, session: Session = Depends(get_session)):
    return session.get(Note, note_id)


@app.delete("/notes/{note_id}", response_model=Message)
def delete_note(note_id: int, session: Session = Depends(get_session)):
    session.delete(session.get(Note, note_id))
    return Message(message="deleted")
"#;

fn drift(root: &std::path::Path, args: &[&str]) -> std::process::Output {
    Command::new(&*BIN)
        .arg("--root")
        .arg(root)
        .arg("--no-cache")
        .args(args)
        .output()
        .unwrap()
}

fn fixture(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (name, text) in files {
        let path = dir.path().join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    dir
}

fn django() -> tempfile::TempDir {
    fixture(&[
        ("requirements.txt", DJANGO_REQUIREMENTS),
        ("manage.py", MANAGE),
        ("shop/__init__.py", ""),
        ("shop/models.py", MODELS),
        ("shop/serializers.py", SERIALIZERS),
        ("shop/forms.py", FORMS),
    ])
}

fn fastapi() -> tempfile::TempDir {
    fixture(&[
        ("requirements.txt", FASTAPI_REQUIREMENTS),
        ("app/__init__.py", ""),
        ("app/models.py", TABLES),
        ("app/db.py", DB),
        ("app/main.py", ROUTES),
    ])
}

/// What is listed, by symbol: the rows, what makes them whole, the fields and
/// where they are withheld.
type Found = BTreeMap<String, (String, String, Vec<String>, Vec<String>)>;

fn found(root: &std::path::Path) -> Found {
    let out = drift(root, &["security", "--json"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    let strings = |x: &Value| -> Vec<String> {
        x.as_array()
            .unwrap()
            .iter()
            .map(|f| f.as_str().unwrap().to_string())
            .collect()
    };
    v["whole_rows"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .map(|w| {
                    (
                        w["symbol"].as_str().unwrap().to_string(),
                        (
                            w["rows"].as_str().unwrap().to_string(),
                            w["from"].as_str().unwrap().to_string(),
                            strings(&w["fields"]),
                            strings(&w["withheld_at"]),
                        ),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

static DJANGO: LazyLock<Found> = LazyLock::new(|| found(django().path()));
static FASTAPI: LazyLock<Found> = LazyLock::new(|| found(fastapi().path()));

#[test]
fn a_class_over_the_whole_model_is_listed_with_what_its_kind_withholds() {
    let (rows, from, fields, at) = &DJANGO["AccountAdminSerializer"];
    assert_eq!(rows, "shop/models.py#Account");
    assert_eq!(from, "fields = \"__all__\"");
    // `exclude` in one serializer, `write_only` by the field and by
    // `extra_kwargs` in two others.
    assert_eq!(fields, &["api_key", "password"]);
    assert_eq!(
        at,
        &[
            "shop/serializers.py#AccountExportSerializer",
            "shop/serializers.py#AccountPublicSerializer",
            "shop/serializers.py#AccountSignupSerializer",
        ]
    );
}

#[test]
fn a_class_that_excludes_gives_everything_else() {
    // `exclude = ["password"]`: `api_key` is still given.
    let (_, from, fields, at) = &DJANGO["AccountExportSerializer"];
    assert_eq!(from, "exclude");
    assert_eq!(fields, &["api_key"]);
    assert_eq!(at, &["shop/serializers.py#AccountPublicSerializer"]);
}

#[test]
fn a_class_that_names_its_fields_or_withholds_them_all_is_not_listed() {
    for class in [
        // Withholds both itself.
        "AccountPublicSerializer",
        // Name their fields.
        "AccountSignupSerializer",
        "AccountListSerializer",
    ] {
        assert!(!DJANGO.contains_key(class), "{class}: {:?}", DJANGO[class]);
    }
}

#[test]
fn a_class_of_another_kind_says_nothing() {
    // A form excludes `note` of an order: the serializer over the whole order is
    // no form. And no form withholds anything of an account.
    for class in ["OrderSerializer", "AccountForm", "OrderForm"] {
        assert!(!DJANGO.contains_key(class), "{class}: {:?}", DJANGO[class]);
    }
    assert_eq!(DJANGO.len(), 2, "{:?}", *DJANGO);
}

#[test]
fn a_field_declared_for_input_only_is_none_of_the_model() {
    // `invite_code = CharField(write_only=True)` is the signup serializer's own.
    for (_, _, fields, _) in DJANGO.values() {
        assert!(!fields.iter().any(|f| f == "invite_code"), "{fields:?}");
    }
}

#[test]
fn a_route_that_declares_the_table_is_listed_with_what_another_response_leaves_out() {
    for (route, from) in [
        ("read_user_raw", "response_model"),
        ("list_users_raw", "response_model"),
        ("find_user", "the return annotation"),
    ] {
        let (rows, said, fields, at) = &FASTAPI[route];
        assert_eq!(rows, "app/models.py#User", "{route}");
        assert_eq!(said, from, "{route}");
        assert_eq!(fields, &["hashed_password", "reset_token"], "{route}");
        assert_eq!(at, &["app/models.py#UserPublic"], "{route}");
    }
}

#[test]
fn a_response_with_no_shared_base_is_tied_by_the_rows_its_route_reads() {
    // `TeamOut(BaseModel)` shares no base with `Team`: it is declared where rows
    // of `Team` are read, and every field it has is one of `Team`'s.
    let (rows, _, fields, at) = &FASTAPI["read_team_raw"];
    assert_eq!(rows, "app/models.py#Team");
    assert_eq!(fields, &["billing_secret"]);
    assert_eq!(at, &["app/models.py#TeamOut"]);
}

#[test]
fn what_the_table_never_gives_back_and_what_nobody_withholds_is_not_listed() {
    for route in [
        // Declare the class with the fields left out.
        "read_user",
        "read_team",
        "read_device",
        // `pairing_code: str = Field(exclude=True)`: the table keeps it back.
        "read_device_raw",
        // No response leaves anything of a note out.
        "read_note",
        // `Message` is no part of a note.
        "delete_note",
    ] {
        assert!(
            !FASTAPI.contains_key(route),
            "{route}: {:?}",
            FASTAPI[route]
        );
    }
    assert_eq!(FASTAPI.len(), 4, "{:?}", *FASTAPI);
}

#[test]
fn a_class_over_the_whole_model_is_a_finding_of_the_baseline() {
    let dir = django();
    let root = dir.path();
    let out = drift(root, &["security", "--write-baseline"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    // A new serializer over the whole account is a finding the baseline does
    // not hold.
    std::fs::write(
        root.join("shop/serializers.py"),
        format!(
            "{SERIALIZERS}\n\nclass AccountDumpSerializer(serializers.ModelSerializer):\n    class Meta:\n        model = Account\n        fields = \"__all__\"\n"
        ),
    )
    .unwrap();
    let out = drift(root, &["security", "--ratchet", "--fail-on", "whole-row"]);
    let said = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(1), "{said}");
    assert!(
        said.contains("AccountDumpSerializer sends shop/models.py#Account whole"),
        "{said}"
    );
}
