"""Start this extracted HEIYAN deployment, sharing its selected port with SiteBridge."""
import argparse
import json
import os
from pathlib import Path
import runpy
import socket
import sys

root = Path(__file__).resolve().parent
comfy = root / 'ComfyUI'
config_path = root / 'SiteBridge' / 'connection.json'
parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=None)
options = parser.parse_args()
config = json.loads(config_path.read_text(encoding='utf-8-sig')) if config_path.exists() else {}
port = options.port if options.port is not None else config.get('comfyPort', 8288)
if type(port) is not int or not 1024 <= port <= 65535 or port in (8289, 8291):
    raise SystemExit('Use a port between 1024 and 65535, excluding connector ports 8289 and 8291.')
with socket.socket() as probe:
    if probe.connect_ex(('127.0.0.1', port)) == 0:
        raise SystemExit(f'Port {port} is already in use. Existing service was not stopped. Use --port 8290 or another free port. The connector will not accept another installation.')
config_path.parent.mkdir(exist_ok=True)
config['comfyPort'] = port
temporary = config_path.with_suffix('.json.tmp')
temporary.write_text(json.dumps(config, indent=2), encoding='utf-8')
temporary.replace(config_path)
for name in ('PYTHONHOME', 'PYTHONPATH'):
    os.environ.pop(name, None)
os.environ['PYTHONUTF8'] = '1'
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
for name in ('input', 'output', 'temp', 'user', 'custom_nodes'):
    (comfy / name).mkdir(exist_ok=True)
os.environ['PATH'] = str(comfy / 'topaz_engine/bin171') + os.pathsep + os.environ.get('PATH', '')
os.chdir(comfy)
sys.path.insert(0, str(comfy))
sys.argv = [str(comfy / 'main.py'), '--listen', '127.0.0.1', '--port', str(port), '--models-directory', str(comfy / 'models'), '--preview-method', 'auto']
print(f'HEIYAN ComfyUI: http://127.0.0.1:{port}', flush=True)
runpy.run_path(str(comfy / 'main.py'), run_name='__main__')
