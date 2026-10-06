"""Server di anteprima del sito.

Come `python -m http.server`, ma dice al browser di non tenere niente
in cache: durante la lavorazione capita di continuo di guardare una
pagina vecchia convinti che la modifica non sia stata fatta.

Uso: python anteprima.py            (porta 8777)
     python anteprima.py 9000
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class SenzaCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, formato, *args):
        if '" 200' not in formato % args:      # solo errori, il resto è rumore
            super().log_message(formato, *args)


if __name__ == '__main__':
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    indirizzo = ('127.0.0.1', porta)
    print(f'Anteprima su http://127.0.0.1:{porta}/  (Ctrl+C per fermare)')
    ThreadingHTTPServer(indirizzo, partial(SenzaCache, directory='.')).serve_forever()
