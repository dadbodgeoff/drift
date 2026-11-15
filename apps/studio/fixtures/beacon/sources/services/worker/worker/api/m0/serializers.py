from rest_framework import serializers


class Model0Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
