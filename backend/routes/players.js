const express = require('express');
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const path = require('path');

const router = express.Router();

// GET /api/players/iframe - Player iFrame
router.get('/iframe', async (req, res) => {
  try {
    const { stream, playlist, video } = req.query;
    
    let videoUrl = '';
    let title = 'Player';
    let isLive = false;
    
    if (stream) {
      // Stream ao vivo
      videoUrl = `http://samhost.wcore.com.br:1935/samhost/${stream}/playlist.m3u8`;
      title = `Stream: ${stream}`;
      isLive = true;
    } else if (playlist) {
      // Playlist específica
      try {
        const [playlistRows] = await db.execute(
          'SELECT nome FROM playlists WHERE id = ?',
          [playlist]
        );
        
        if (playlistRows.length > 0) {
          title = `Playlist: ${playlistRows[0].nome}`;
          // Para playlist, usar o primeiro vídeo
          const [videoRows] = await db.execute(
            'SELECT path_video, video FROM playlists_videos WHERE codigo_playlist = ? ORDER BY ordem LIMIT 1',
            [playlist]
          );
          
          if (videoRows.length > 0) {
            videoUrl = `/content${videoRows[0].path_video}`;
            title = videoRows[0].video;
          }
        }
      } catch (error) {
        console.error('Erro ao carregar playlist:', error);
      }
    } else if (video) {
      // Vídeo específico
      try {
        const [videoRows] = await db.execute(
          'SELECT path_video, video FROM playlists_videos WHERE codigo = ?',
          [video]
        );
        
        if (videoRows.length > 0) {
          videoUrl = `/content${videoRows[0].path_video}`;
          title = videoRows[0].video;
        }
      } catch (error) {
        console.error('Erro ao carregar vídeo:', error);
      }
    }

    // Gerar HTML do player
    const playerHTML = `
<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: #000;
            font-family: Arial, sans-serif;
            overflow: hidden;
        }
        
        .player-container {
            position: relative;
            width: 100vw;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        video {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
        
        .player-overlay {
            position: absolute;
            top: 20px;
            left: 20px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            font-size: 14px;
            z-index: 10;
        }
        
        .live-indicator {
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        
        .live-dot {
            width: 8px;
            height: 8px;
            background: #ff0000;
            border-radius: 50%;
            animation: pulse 1.5s infinite;
        }
        
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        
        .error-message {
            color: white;
            text-align: center;
            padding: 20px;
        }
    </style>
</head>
<body>
    <div class="player-container">
        <div class="player-overlay">
            <div class="live-indicator">
                ${isLive ? '<div class="live-dot"></div><span>AO VIVO</span>' : '<span>VOD</span>'}
            </div>
            <div>${title}</div>
        </div>
        
        <video id="video" controls autoplay muted playsinline>
            <p class="error-message">Seu navegador não suporta reprodução de vídeo.</p>
        </video>
    </div>

    <script>
        const video = document.getElementById('video');
        const videoUrl = '${videoUrl}';
        const isLive = ${isLive};
        
        if (!videoUrl) {
            document.querySelector('.player-container').innerHTML = 
                '<div class="error-message">Nenhum vídeo especificado</div>';
        } else {
            // Detectar tipo de arquivo
            const isHLS = videoUrl.includes('.m3u8') || isLive;
            
            if (isHLS && Hls.isSupported()) {
                // Usar HLS.js para streams
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: isLive,
                    backBufferLength: isLive ? 10 : 30,
                    maxBufferLength: isLive ? 20 : 60,
                    debug: false
                });
                
                hls.loadSource(videoUrl);
                hls.attachMedia(video);
                
                hls.on(Hls.Events.MANIFEST_PARSED, function() {
                    console.log('HLS manifest carregado');
                });
                
                hls.on(Hls.Events.ERROR, function(event, data) {
                    console.error('HLS Error:', data);
                    if (data.fatal) {
                        document.querySelector('.player-container').innerHTML = 
                            '<div class="error-message">Erro ao carregar stream: ' + (data.details || 'Erro desconhecido') + '</div>';
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl') && isHLS) {
                // Safari nativo para HLS
                video.src = videoUrl;
            } else {
                // Vídeo regular
                video.src = videoUrl;
            }
            
            // Event listeners
            video.addEventListener('error', function(e) {
                console.error('Video error:', e);
                document.querySelector('.player-container').innerHTML = 
                    '<div class="error-message">Erro ao carregar vídeo</div>';
            });
            
            video.addEventListener('loadstart', function() {
                console.log('Iniciando carregamento do vídeo');
            });
            
            video.addEventListener('canplay', function() {
                console.log('Vídeo pronto para reprodução');
            });
        }
        
        // Tentar reproduzir automaticamente
        video.play().catch(function(error) {
            console.log('Autoplay falhou:', error);
            // Autoplay pode falhar por políticas do navegador
        });
    </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(playerHTML);
    
  } catch (error) {
    console.error('Erro no player iframe:', error);
    res.status(500).send(`
<!DOCTYPE html>
<html>
<head><title>Erro</title></head>
<body style="background:#000;color:white;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:Arial">
    <div style="text-align:center">
        <h2>Erro no Player</h2>
        <p>Não foi possível carregar o conteúdo solicitado.</p>
    </div>
</body>
</html>`);
  }
});

// GET /api/players/social - Player para redes sociais
router.get('/social', async (req, res) => {
  try {
    const { stream } = req.query;
    
    if (!stream) {
      return res.status(400).send('Stream parameter required');
    }
    
    const videoUrl = `http://samhost.wcore.com.br:1935/samhost/${stream}/playlist.m3u8`;
    
    const socialHTML = `
<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Stream: ${stream}</title>
    <meta property="og:title" content="Stream ao vivo: ${stream}">
    <meta property="og:description" content="Assista ao stream ao vivo">
    <meta property="og:type" content="video.other">
    <meta property="og:url" content="${req.protocol}://${req.get('host')}${req.originalUrl}">
    <meta property="og:video" content="${videoUrl}">
    <meta property="og:video:type" content="application/vnd.apple.mpegurl">
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <style>
        body { margin: 0; background: #000; }
        .container { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; }
        video { width: 100%; height: 100%; object-fit: contain; }
    </style>
</head>
<body>
    <div class="container">
        <video id="video" controls autoplay muted playsinline>
            <source src="${videoUrl}" type="application/vnd.apple.mpegurl">
        </video>
    </div>
    <script>
        const video = document.getElementById('video');
        if (Hls.isSupported()) {
            const hls = new Hls();
            hls.loadSource('${videoUrl}');
            hls.attachMedia(video);
        }
    </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(socialHTML);
    
  } catch (error) {
    console.error('Erro no player social:', error);
    res.status(500).send('Erro interno do servidor');
  }
});

module.exports = router;