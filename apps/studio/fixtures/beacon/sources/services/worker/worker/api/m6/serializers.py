from rest_framework import serializers


class Model6Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
