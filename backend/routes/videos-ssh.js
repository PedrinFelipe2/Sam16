const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const VideoSSHManager = require('../config/VideoSSHManager');
const SSHManager = require('../config/SSHManager');

const router = express.Router();

// GET /api/videos-ssh/folders/:folderId/usage - Estatísticas de uso da pasta
router.get('/folders/:folderId/usage', authMiddleware, async (req, res) => {
  try {
    const { folderId } = req.params;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Buscar dados da pasta e servidor
    const [folderRows] = await db.execute(
      'SELECT identificacao, codigo_servidor, espaco, espaco_usado FROM streamings WHERE codigo = ? AND codigo_cliente = ?',
      [folderId, userId]
    );

    if (folderRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Pasta não encontrada'
      });
    }

    const folder = folderRows[0];
    const serverId = folder.codigo_servidor || 1;
    const folderName = folder.identificacao;

    // Calcular uso real da pasta via SSH
    try {
      const remotePath = `/usr/local/WowzaStreamingEngine/content/${userLogin}/${folderName}`;
      const duCommand = `du -sb "${remotePath}" 2>/dev/null | cut -f1 || echo "0"`;
      const result = await SSHManager.executeCommand(serverId, duCommand);
      const realUsage = parseInt(result.stdout.trim()) || 0;
      
      // Converter para MB
      const realUsageMB = Math.ceil(realUsage / (1024 * 1024));
      
      res.json({
        success: true,
        usage: {
          used: realUsageMB,
          total: folder.espaco,
          percentage: Math.round((realUsageMB / folder.espaco) * 100),
          available: folder.espaco - realUsageMB,
          database_used: folder.espaco_usado,
          real_used: realUsageMB
        }
      });
    } catch (sshError) {
      // Fallback para dados do banco
      res.json({
        success: true,
        usage: {
          used: folder.espaco_usado,
          total: folder.espaco,
          percentage: Math.round((folder.espaco_usado / folder.espaco) * 100),
          available: folder.espaco - folder.espaco_usado,
          database_used: folder.espaco_usado,
          real_used: folder.espaco_usado
        }
      });
    }
  } catch (error) {
    console.error('Erro ao obter estatísticas de uso:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao obter estatísticas de uso'
    });
  }
});

// POST /api/videos-ssh/folders/:folderId/sync - Sincronizar pasta com servidor
router.post('/folders/:folderId/sync', authMiddleware, async (req, res) => {
  try {
    const { folderId } = req.params;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Buscar dados da pasta
    const [folderRows] = await db.execute(
      'SELECT identificacao, codigo_servidor FROM streamings WHERE codigo = ? AND codigo_cliente = ?',
      [folderId, userId]
    );

    if (folderRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Pasta não encontrada'
      });
    }

    const folder = folderRows[0];
    const serverId = folder.codigo_servidor || 1;
    const folderName = folder.identificacao;

    // Listar vídeos do servidor
    const videos = await VideoSSHManager.listVideosFromServer(serverId, userLogin, folderName);
    
    // Sincronizar com banco de dados
    let syncedCount = 0;
    let totalSize = 0;

    for (const video of videos) {
      try {
        // Verificar se vídeo já existe no banco
        const relativePath = `/${userLogin}/${folderName}/${video.nome}`;
        const [existingRows] = await db.execute(
          'SELECT codigo FROM playlists_videos WHERE path_video = ?',
          [relativePath]
        );

        if (existingRows.length === 0) {
          // Inserir novo vídeo no banco
          await db.execute(
            `INSERT INTO playlists_videos (
              codigo_playlist, path_video, video, width, height,
              bitrate, duracao, duracao_segundos, tipo, ordem, tamanho_arquivo
            ) VALUES (0, ?, ?, 1920, 1080, 2500, ?, ?, 'video', 0, ?)`,
            [
              relativePath,
              video.nome,
              VideoSSHManager.formatDuration(video.duration),
              video.duration,
              video.size
            ]
          );
          syncedCount++;
        }
        
        totalSize += video.size;
      } catch (dbError) {
        console.error(`Erro ao sincronizar vídeo ${video.nome}:`, dbError);
      }
    }

    // Atualizar espaço usado no banco
    const totalSizeMB = Math.ceil(totalSize / (1024 * 1024));
    await db.execute(
      'UPDATE streamings SET espaco_usado = ? WHERE codigo = ?',
      [totalSizeMB, folderId]
    );

    res.json({
      success: true,
      message: `Sincronização concluída: ${syncedCount} novos vídeos adicionados`,
      stats: {
        total_videos: videos.length,
        synced_videos: syncedCount,
        total_size_mb: totalSizeMB
      }
    });
  } catch (error) {
    console.error('Erro na sincronização:', error);
    res.status(500).json({
      success: false,
      error: 'Erro na sincronização com servidor'
    });
  }
});

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

    // Atualizar banco de dados se o vídeo estiver registrado
    try {
      const oldRelativePath = remotePath.replace('/usr/local/WowzaStreamingEngine/content', '');
      const newRelativePath = newRemotePath.replace('/usr/local/WowzaStreamingEngine/content', '');
      
      await db.execute(
        'UPDATE playlists_videos SET path_video = ?, video = ? WHERE path_video = ?',
        [newRelativePath, novo_nome.trim(), oldRelativePath]
      );
    } catch (dbError) {
      console.warn('Aviso: Erro ao atualizar banco de dados:', dbError.message);
    }
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

    // Obter informações do arquivo antes de deletar
    const fileInfo = await SSHManager.getFileInfo(serverId, remotePath);
    const fileSize = fileInfo.exists ? fileInfo.size : 0;

    // Deletar vídeo do servidor
    await VideoSSHManager.deleteVideoFromServer(serverId, remotePath);

    // Atualizar banco de dados
    try {
      const relativePath = remotePath.replace('/usr/local/WowzaStreamingEngine/content', '');
      
      // Remover do banco de dados
      const [deleteResult] = await db.execute(
        'DELETE FROM playlists_videos WHERE path_video = ?',
        [relativePath]
      );
      
      // Atualizar espaço usado se arquivo foi removido
      if (fileSize > 0) {
        const sizeMB = Math.ceil(fileSize / (1024 * 1024));
        await db.execute(
          'UPDATE streamings SET espaco_usado = GREATEST(espaco_usado - ?, 0) WHERE codigo_cliente = ?',
          [sizeMB, userId]
        );
      }
      
      console.log(`✅ Vídeo removido do banco: ${relativePath}`);
    } catch (dbError) {
      console.warn('Aviso: Erro ao atualizar banco de dados:', dbError.message);
    }
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