from rest_framework import serializers


class Model2Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
