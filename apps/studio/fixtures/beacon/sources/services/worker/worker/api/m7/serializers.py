from rest_framework import serializers


class Model7Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
