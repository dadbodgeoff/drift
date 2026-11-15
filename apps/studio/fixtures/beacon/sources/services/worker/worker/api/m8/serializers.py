from rest_framework import serializers


class Model8Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
