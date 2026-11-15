from rest_framework import serializers


class Model9Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
