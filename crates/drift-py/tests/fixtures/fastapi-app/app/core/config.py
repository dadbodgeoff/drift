import os


class Settings:
    PROJECT_NAME = "demo"
    DATABASE_URL = os.environ["DATABASE_URL"]
    SECRET_KEY = os.getenv("SECRET_KEY", "dev")


settings = Settings()
