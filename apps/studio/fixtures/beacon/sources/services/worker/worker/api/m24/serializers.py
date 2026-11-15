from rest_framework import serializers


class Model24Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
