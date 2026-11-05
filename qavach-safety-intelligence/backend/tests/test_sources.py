import pytest

from qavach import config, sources


def test_youtube_and_stream_addresses_are_told_apart():
    assert sources.classify('https://www.youtube.com/live/QO-hO_kwwmY') == 'youtube'
    assert sources.classify('https://youtu.be/QO-hO_kwwmY') == 'youtube'
    assert sources.classify('rtsp://10.40.1.25:554/stream1') == 'stream'
    assert sources.classify('https://cams.example.com/hls/berth2.m3u8') == 'stream'


@pytest.mark.parametrize('bad', ['', 'not a url', '/etc/passwd', 'file:///etc/passwd', 'ftp://host/x', 'rtsp://', 'javascript:alert(1)'])
def test_anything_that_is_not_a_network_address_is_refused(bad):
    with pytest.raises(sources.SourceError):
        sources.classify(bad)


def test_stream_credentials_are_added_and_encoded():
    assert sources.with_credentials('rtsp://10.0.0.5:554/s1', '', '') == 'rtsp://10.0.0.5:554/s1'
    assert sources.with_credentials('rtsp://10.0.0.5:554/s1', 'svc', 'p@ss/w:rd') == 'rtsp://svc:p%40ss%2Fw%3Ard@10.0.0.5:554/s1'


def test_source_from_the_page_is_validated(tmp_path, monkeypatch):
    monkeypatch.setattr(config, 'UPLOADS', tmp_path)
    (tmp_path / 'abcdef012345.mp4').write_bytes(b'x')
    link = sources.source_from_dict(dict(kind='link', url='rtsp://10.0.0.5/s1', user='svc', password='pw'))
    assert (link.kind, link.live, link.password) == ('stream', True, 'pw')
    upload = sources.source_from_dict(dict(kind='upload', uploadId='abcdef012345'))
    assert (upload.kind, upload.live) == ('upload', False)
    for bad in (None, dict(kind='link', url='/etc/passwd'), dict(kind='upload', uploadId='../../etc/passwd'),
                dict(kind='upload', uploadId='000000000000'), dict(kind='nope')):
        with pytest.raises(sources.SourceError):
            sources.source_from_dict(bad)
