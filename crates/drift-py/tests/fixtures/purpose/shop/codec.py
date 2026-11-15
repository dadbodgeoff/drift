import json


def dumps(obj, depth=0):
    if depth:
        return dumps(obj, depth - 1)
    return json.dumps(str(obj))
