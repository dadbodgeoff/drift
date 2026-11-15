import asyncio
import subprocess


async def _warm():
    return None


def run(cmd):
    asyncio.run(_warm())
    return subprocess.run(cmd, check=True)
