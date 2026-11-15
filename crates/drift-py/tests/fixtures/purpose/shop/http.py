import os

import requests

session = requests.Session()


def get(url, **kwargs):
    kwargs.setdefault("timeout", float(os.environ.get("HTTP_TIMEOUT", "10")))
    return session.get(url, **kwargs)


def post(url, **kwargs):
    return requests.post(url, **kwargs)
