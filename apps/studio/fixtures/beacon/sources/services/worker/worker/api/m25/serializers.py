from rest_framework import serializers


class Model25Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
