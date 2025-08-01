const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const VideoSSHManager = require('../config/VideoSSHManager');

const router = express.Router();

// PUT /api/videos-ssh/:videoId/rename - Renomear vídeo
router.put('/:videoId/rename', authMiddleware, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { novo_nome } = req.body;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    if (!novo_nome || !novo_nome.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Novo nome é obrigatório'
      });
    }

    // Decodificar o caminho do vídeo
    const remotePath = Buffer.from(videoId, 'base64').toString();
    
    // Verificar se o vídeo pertence ao usuário
    if (!remotePath.includes(`/${userLogin}/`)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado'
      });
    }

    // Buscar servidor do usuário
    const [serverRows] = await db.execute(
      'SELECT codigo_servidor FROM streamings WHERE codigo_cliente = ? LIMIT 1',
      [userId]
    );

    const serverId = serverRows.length > 0 ? serverRows[0].codigo_servidor : 1;

    // Construir novo caminho
    const pathParts = remotePath.split('/');
    const oldFileName = pathParts[pathParts.length - 1];
    const fileExtension = path.extname(oldFileName);
    const newFileName = novo_nome.trim() + fileExtension;
    
    pathParts[pathParts.length - 1] = newFileName;
    const newRemotePath = pathParts.join('/');

    // Renomear arquivo no servidor
    const renameCommand = `mv "${remotePath}" "${newRemotePath}"`;
    await SSHManager.executeCommand(serverId, renameCommand);

    console.log(`✅ Vídeo renomeado: ${oldFileName} → ${newFileName}`);

    res.json({
      success: true,
      message: 'Vídeo renomeado com sucesso',
      old_name: oldFileName,
      new_name: newFileName,
      new_path: newRemotePath
    });

  } catch (error) {
    console.error('Erro ao renomear vídeo:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao renomear vídeo',
      details: error.message
    });
  }
});

// GET /api/videos-ssh/list - Lista vídeos diretamente do servidor via SSH
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const userLogin = req.user.email ? req.user.email.split('@')[0] : `user_${userId}`;
    const { folder } = req.query;

    // Buscar servidor do usuário
    const [serverRows] = await db.execute(
      'SELECT codigo_servidor FROM streamings WHERE codigo_cliente = ? LIMIT 1',
      [userId]
    );

    const serverId = serverRows.length > 0 ? serverRows[0].codigo_servidor : 1;

    // Listar vídeos do servidor
    const videos = await VideoSSHManager.listVideosFromServer(serverId, userLogin, folder);

    res.json({
      success: true,
      videos: videos,
      server_id: serverId,
      user_login: userLogin,
      total_videos: videos.length,
      total_size: videos.reduce((acc, v) => acc + v.size, 0)
    });
  } catch (error) {
    console.error('Erro ao listar vídeos via SSH:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao listar vídeos do servidor',
      details: error.message
    });
  }
});

// GET /api/videos-ssh/info/:videoId - Obter informações detalhadas do vídeo
router.get('/info/:videoId', authMiddleware, async (req, res) => {
  try {
    const { videoId } = req.params;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Decodificar o caminho do vídeo
    const remotePath = Buffer.from(videoId, 'base64').toString();
    
    // Buscar servidor do usuário
    const [serverRows] = await db.execute(
      'SELECT codigo_servidor FROM streamings WHERE codigo_cliente = ? LIMIT 1',
      [userId]
    );

    const serverId = serverRows.length > 0 ? serverRows[0].codigo_servidor : 1;

    // Verificar disponibilidade
    const availability = await VideoSSHManager.checkVideoAvailability(serverId, remotePath);
    
    if (!availability.available) {
      return res.status(404).json({
        success: false,
        error: availability.reason
      });
    }

    // Obter informações detalhadas
    const videoInfo = await VideoSSHManager.getVideoInfo(serverId, remotePath);

    res.json({
      success: true,
      video_info: videoInfo,
      availability: availability,
      video_id: videoId,
      remote_path: remotePath
    });
  } catch (error) {
    console.error('Erro ao obter informações do vídeo:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao obter informações do vídeo',
      details: error.message
    });
  }
});

// GET /api/videos-ssh/stream/:videoId - Stream do vídeo via SSH
router.get('/stream/:videoId', authMiddleware, async (req, res) => {
  try {
    const { videoId } = req.params;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Decodificar o caminho do vídeo
    const remotePath = Buffer.from(videoId, 'base64').toString();
    
    // Verificar se o vídeo pertence ao usuário
    if (!remotePath.includes(`/${userLogin}/`)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado ao vídeo'
      });
    }

    // Buscar servidor do usuário
    const [serverRows] = await db.execute(
      'SELECT codigo_servidor FROM streamings WHERE codigo_cliente = ? LIMIT 1',
      [userId]
    );

    const serverId = serverRows.length > 0 ? serverRows[0].codigo_servidor : 1;

    console.log(`🎥 Solicitação de stream para: ${path.basename(remotePath)}`);

    // Obter stream do vídeo
    const streamResult = await VideoSSHManager.getVideoStream(serverId, remotePath, videoId);

    if (!streamResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao obter stream do vídeo'
      });
    }

    // Servir arquivo local
    if (streamResult.type === 'local') {
      const localPath = streamResult.path;
      
      try {
        const stats = await fs.stat(localPath);
        const fileName = path.basename(remotePath);
        
        // Configurar headers para streaming
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
        
        // Suporte a Range requests para seeking
        const range = req.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
          const chunksize = (end - start) + 1;
          
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
          res.setHeader('Content-Length', chunksize);
          
          const stream = require('fs').createReadStream(localPath, { start, end });
          stream.pipe(res);
        } else {
          const stream = require('fs').createReadStream(localPath);
          stream.pipe(res);
        }
        
        console.log(`✅ Servindo vídeo ${streamResult.cached ? '(cache)' : '(novo)'}: ${fileName}`);
        
      } catch (fileError) {
        console.error('Erro ao servir arquivo local:', fileError);
        res.status(500).json({
          success: false,
          error: 'Erro ao acessar arquivo local'
        });
      }
    } else {
      res.status(500).json({
        success: false,
        error: 'Tipo de stream não suportado'
      });
    }

  } catch (error) {
    console.error('Erro no stream do vídeo:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

// GET /api/videos-ssh/thumbnail/:videoId - Thumbnail do vídeo
router.get('/thumbnail/:videoId', authMiddleware, async (req, res) => {
  try {
    const { videoId } = req.params;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Decodificar o caminho do vídeo
    const remotePath = Buffer.from(videoId, 'base64').toString();
    
    // Verificar se o vídeo pertence ao usuário
    if (!remotePath.includes(`/${userLogin}/`)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado'
      });
    }

    // Buscar servidor do usuário
    const [serverRows] = await db.execute(
      'SELECT codigo_servidor FROM streamings WHERE codigo_cliente = ? LIMIT 1',
      [userId]
    );

    const serverId = serverRows.length > 0 ? serverRows[0].codigo_servidor : 1;

    // Gerar/obter thumbnail
    const thumbnailResult = await VideoSSHManager.generateVideoThumbnail(serverId, remotePath, videoId);

    if (thumbnailResult.success) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache por 24 horas
      
      const stream = require('fs').createReadStream(thumbnailResult.thumbnailPath);
      stream.pipe(res);
    } else {
      // Retornar thumbnail padrão
      res.status(404).json({
        success: false,
        error: 'Thumbnail não disponível'
      });
    }

  } catch (error) {
    console.error('Erro ao obter thumbnail:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao gerar thumbnail'
    });
  }
});

// DELETE /api/videos-ssh/:videoId - Deletar vídeo do servidor
router.delete('/:videoId', authMiddleware, async (req, res) => {
  try {
    const { videoId } = req.params;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Decodificar o caminho do vídeo
    const remotePath = Buffer.from(videoId, 'base64').toString();
    
    // Verificar se o vídeo pertence ao usuário
    if (!remotePath.includes(`/${userLogin}/`)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado'
      });
    }

    // Buscar servidor do usuário
    const [serverRows] = await db.execute(
      'SELECT codigo_servidor FROM streamings WHERE codigo_cliente = ? LIMIT 1',
      [userId]
    );

    const serverId = serverRows.length > 0 ? serverRows[0].codigo_servidor : 1;

    // Deletar vídeo do servidor
    await VideoSSHManager.deleteVideoFromServer(serverId, remotePath);

    res.json({
      success: true,
      message: 'Vídeo removido com sucesso do servidor'
    });

  } catch (error) {
    console.error('Erro ao deletar vídeo:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao remover vídeo',
      details: error.message
    });
  }
});

// GET /api/videos-ssh/cache/status - Status do cache
router.get('/cache/status', authMiddleware, async (req, res) => {
  try {
    const cacheStatus = await VideoSSHManager.getCacheStatus();
    res.json({
      success: true,
      cache: cacheStatus
    });
  } catch (error) {
    console.error('Erro ao obter status do cache:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao obter status do cache'
    });
  }
});

// POST /api/videos-ssh/cache/clear - Limpar cache
router.post('/cache/clear', authMiddleware, async (req, res) => {
  try {
    const result = await VideoSSHManager.clearCache();
    res.json({
      success: true,
      message: `Cache limpo: ${result.removedFiles} arquivos removidos`
    });
  } catch (error) {
    console.error('Erro ao limpar cache:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao limpar cache'
    });
  }
});

module.exports = router;