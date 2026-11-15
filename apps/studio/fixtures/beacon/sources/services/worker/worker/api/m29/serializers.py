from rest_framework import serializers


class RefundPayload(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
