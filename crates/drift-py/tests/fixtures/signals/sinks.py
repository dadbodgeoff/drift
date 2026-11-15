import hashlib
import os
import pickle
import subprocess

import jwt
import requests
import yaml
from django.shortcuts import redirect
from django.urls import reverse
from django.utils.safestring import mark_safe

API = "https://api.example.com"


def run_eval(expr):
    return eval(expr)


def run_literal_eval():
    return eval("1 + 1")


def shell(cmd):
    os.system(cmd)
    subprocess.run(cmd, shell=True)


def no_shell(path):
    subprocess.run(["ls", path], check=True)


def sql(cursor, name, table):
    cursor.execute(f"SELECT * FROM users WHERE name = '{name}'")
    cursor.execute("DELETE FROM %s WHERE id = 1" % table)


def safe_sql(cursor, name):
    cursor.execute("SELECT * FROM users WHERE name = %s", [name])


def raw_sql(sql_text):
    from shop.models import Order

    return Order.objects.raw(sql_text)


def deserialize(blob, text):
    pickle.loads(blob)
    yaml.load(text)


def safe_deserialize(text):
    yaml.load(text, Loader=yaml.SafeLoader)
    return yaml.safe_load(text)


def fetch(url, item_id):
    requests.get(url)
    requests.post(f"{url}/items")


def fixed_fetch(item_id):
    requests.get(f"https://api.example.com/items/{item_id}")
    requests.get(API)


def hashes(data):
    hashlib.md5(data)
    hashlib.new("sha1", data)


def hash_ok(data):
    hashlib.md5(data, usedforsecurity=False)
    hashlib.sha256(data)


def decode(token):
    return jwt.decode(token, options={"verify_signature": False})


def cookies(response, value):
    response.set_cookie("session", value)


def cookies_ok(response, value):
    response.set_cookie("session", value, httponly=True, secure=True)


def html(user_input):
    return mark_safe(user_input)


def redirects(request):
    return redirect(request.GET["next"])


def redirects_ok(request):
    return redirect(reverse("home"))


# A comment that is not about the next function.

# drift-ignore D-abc123: legacy endpoint kept for the mobile app
# drift-ignore D-def456
def suppressed(request):
    return None
