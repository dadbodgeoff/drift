import requests

API = "https://api.example.com"


def get(path, timeout=10):
    return requests.get(API + path, timeout=timeout)
