"""The detection service behind the console: camera sources, frames for drawing zones, live previews, and alerts.

    ./run.sh                    # then the console talks to http://127.0.0.1:8830

Everything listens on localhost only. The console (npm run dev) proxies /api here; the single-file build calls it
directly, which is why cross-origin requests are allowed.
"""
import argparse
import asyncio
import os
import re
import uuid
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

import cv2

from qavach import config, sources
from qavach.registry import Invalid, Registry

HEX12 = re.compile(r'^[0-9a-f]{12}$')
EVENT_ID = re.compile(r'^EV-[0-9a-f]{8}$')
registry = Registry()
app = FastAPI(title='Qavach safety intelligence · detection service')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])


@app.on_event('startup')
def _startup():
    for folder in (config.FRAMES, config.UPLOADS, config.SNAPSHOTS):
        folder.mkdir(parents=True, exist_ok=True)
    registry.load()


@app.on_event('shutdown')
def _shutdown():
    registry.shutdown()


def bad(error):
    return HTTPException(400, str(error))


@app.get('/api/health')
def health():
    return dict(ok=True, epoch=registry.epoch, detector=registry.detector_loaded, cameras=len(registry.cameras),
                rules=len(registry.rules))


# ── sources: upload, test connection, still frames ───────────────────────────────────────────────────────────────
def save_frame(frame):
    frame_id = uuid.uuid4().hex[:12]
    cv2.imwrite(str(config.FRAMES / f'{frame_id}.jpg'), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return frame_id


def probe_payload(source):
    try:
        frame, info = sources.probe(source)
    except sources.SourceError as error:
        raise bad(error)
    frame_id = save_frame(frame)
    return dict(frameId=frame_id, frameUrl=f'/api/frames/{frame_id}.jpg', kind=source.kind, **info)


@app.post('/api/sources/probe')
async def probe(request: Request):
    """Test a connection: open the source, read one frame, keep it for the zone editor."""
    body = await request.json()
    try:
        source = sources.source_from_dict(body.get('source'))
    except sources.SourceError as error:
        raise bad(error)
    return await asyncio.to_thread(probe_payload, source)


@app.put('/api/uploads')
async def upload(request: Request, name: str = 'upload.mp4'):
    """Raw-body upload (fetch(file)): no multipart dependency. The file is checked by reading a frame from it."""
    suffix = Path(name).suffix.lower()
    if suffix not in config.VIDEO_SUFFIXES:
        raise HTTPException(400, 'Use an .mp4, .mov, .avi, .mkv or .webm file')
    upload_id = uuid.uuid4().hex[:12]
    config.UPLOADS.mkdir(parents=True, exist_ok=True)
    target = config.UPLOADS / f'{upload_id}{suffix}'
    size = 0
    with target.open('wb') as handle:
        async for chunk in request.stream():
            size += len(chunk)
            if size > config.MAX_UPLOAD_BYTES:
                handle.close()
                target.unlink(missing_ok=True)
                raise HTTPException(413, 'File larger than 2 GB')
            handle.write(chunk)
    try:
        payload = await asyncio.to_thread(probe_payload, sources.Source('upload', upload_id=upload_id))
    except HTTPException:
        target.unlink(missing_ok=True)
        raise HTTPException(400, 'Could not read that video')
    return dict(uploadId=upload_id, name=Path(name).stem[:60], bytes=size, **payload)


def serve_jpeg(folder, name, pattern):
    if not pattern.match(name):
        raise HTTPException(404)
    path = folder / f'{name}.jpg'
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path, media_type='image/jpeg', headers={'Cache-Control': 'max-age=3600'})


@app.get('/api/frames/{frame_id}.jpg')
def frame_file(frame_id: str):
    return serve_jpeg(config.FRAMES, frame_id, HEX12)


@app.get('/api/snapshots/{event_id}.jpg')
def snapshot_file(event_id: str):
    return serve_jpeg(config.SNAPSHOTS, event_id, EVENT_ID)


# ── cameras and rules pushed by the console ──────────────────────────────────────────────────────────────────────────
def guarded(fn, *args):
    try:
        return fn(*args)
    except Invalid as error:
        raise bad(error)


@app.put('/api/cameras/{camera_id}')
async def put_camera(camera_id: str, request: Request):
    body = await request.json()
    body['id'] = camera_id
    await asyncio.to_thread(guarded, registry.put_camera, body)
    return dict(ok=True)


@app.delete('/api/cameras/{camera_id}')
async def delete_camera(camera_id: str):
    await asyncio.to_thread(registry.delete_camera, camera_id)
    return dict(ok=True)


@app.put('/api/rules/{rule_id}')
async def put_rule(rule_id: str, request: Request):
    body = await request.json()
    body['id'] = rule_id
    await asyncio.to_thread(guarded, registry.put_rule, body)
    return dict(ok=True)


@app.delete('/api/rules/{rule_id}')
async def delete_rule(rule_id: str):
    await asyncio.to_thread(registry.delete_rule, rule_id)
    return dict(ok=True)


@app.post('/api/sync')
async def sync(request: Request):
    """The console sends every camera and rule when it opens, so the service matches it after a restart."""
    body = await request.json()
    problems = await asyncio.to_thread(registry.sync, body.get('cameras') or [], body.get('rules') or [])
    return dict(ok=True, problems=problems)


# ── live: events, status, preview ────────────────────────────────────────────────────────────────────────────────────
@app.get('/api/events')
def events(since: int = 0):
    """Alerts raised since a cursor, plus the state of every camera. The console polls this once a second."""
    found, latest = registry.events_since(since)
    return dict(epoch=registry.epoch, next=latest, events=found, cameras=registry.statuses())


def runner_or_404(camera_id):
    runner = registry.runner(camera_id)
    if runner is None:
        raise HTTPException(404, 'That camera is not running on the service')
    return runner


@app.get('/api/cameras/{camera_id}/frame.jpg')
def camera_frame(camera_id: str):
    data = runner_or_404(camera_id).snapshot()
    if data is None:
        raise HTTPException(404, 'No picture yet')
    return Response(data, media_type='image/jpeg', headers={'Cache-Control': 'no-store'})


@app.get('/api/cameras/{camera_id}/stream.mjpg')
async def camera_stream(camera_id: str):
    runner = runner_or_404(camera_id)

    async def frames():
        last = 0
        while runner.state != 'stopped' and not runner.stop_flag.is_set():
            if runner.seq != last and runner.jpeg:
                last, data = runner.seq, runner.jpeg
                yield b'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + str(len(data)).encode() + b'\r\n\r\n' + data + b'\r\n'
            else:
                await asyncio.sleep(0.02)

    return StreamingResponse(frames(), media_type='multipart/x-mixed-replace; boundary=frame',
                             headers={'Cache-Control': 'no-store'})


if config.WEB and (config.WEB / 'index.html').exists():
    app.mount('/', StaticFiles(directory=config.WEB, html=True), name='console')       # after every /api route


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--host', default=os.environ.get('QAVACH_HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=8830)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level='warning')


if __name__ == '__main__':
    main()
