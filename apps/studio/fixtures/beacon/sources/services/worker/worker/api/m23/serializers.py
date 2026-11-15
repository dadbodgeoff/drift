from rest_framework import serializers


class Model23Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
