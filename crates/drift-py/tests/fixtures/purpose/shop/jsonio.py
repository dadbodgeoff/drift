import json


def load(fp, **kwargs):
    return json.load(fp, **kwargs)


def loads(text):
    def parse(text):
        return json.loads(text)

    return parse(text)
