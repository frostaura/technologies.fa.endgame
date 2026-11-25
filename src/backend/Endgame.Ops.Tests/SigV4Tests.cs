using Endgame.Ops.Backups;

namespace Endgame.Ops.Tests;

public sealed class SigV4Tests
{
    /// <summary>
    /// The "Example: GET Object" worked example in AWS's Signature Version 4 documentation
    /// (https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html), whose
    /// published signature is f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41.
    /// </summary>
    [Fact]
    public void Reproduces_the_published_get_object_signature()
    {
        var headers = new Dictionary<string, string>
        {
            ["host"] = "examplebucket.s3.amazonaws.com",
            ["range"] = "bytes=0-9",
            ["x-amz-content-sha256"] = SigV4.EmptyPayloadHash,
            ["x-amz-date"] = "20130524T000000Z",
        };
        var authorization = SigV4.Authorization(
            "GET",
            "/test.txt",
            [],
            headers,
            SigV4.EmptyPayloadHash,
            new DateTimeOffset(2013, 5, 24, 0, 0, 0, TimeSpan.Zero),
            "us-east-1",
            "AKIAIOSFODNN7EXAMPLE",
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");

        Assert.Equal(
            "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
            authorization);
    }

    [Fact]
    public void Encodes_everything_but_the_unreserved_characters()
    {
        Assert.Equal("a%20b%2Fc~d_e.f-g", SigV4.Encode("a b/c~d_e.f-g"));
        Assert.Equal("endgame/endgame-1.egbk", SigV4.Encode("endgame/endgame-1.egbk", keepSlash: true));
        Assert.Equal("%C3%A9", SigV4.Encode("é"));
    }
}
