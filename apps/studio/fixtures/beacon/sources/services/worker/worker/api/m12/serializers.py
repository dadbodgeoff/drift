from rest_framework import serializers


class Model12Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
