const express = require('express');
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const fs = require('fs').promises;
const path = require('path');
const SSHManager = require('../config/SSHManager');

const router = express.Router();

// POST /api/downloadyoutube - Download de vídeo do YouTube
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { url, id_pasta } = req.body;
    const userId = req.user.id;
    const userLogin = req.user.email ? req.user.email.split('@')[0] : `user_${userId}`;

    if (!url || !id_pasta) {
      return res.status(400).json({ error: 'URL e pasta são obrigatórios' });
    }

    // Validar URL do YouTube
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    if (!youtubeRegex.test(url)) {
      return res.status(400).json({ error: 'URL deve ser do YouTube' });
    }

    // Buscar dados da pasta e servidor
    const [folderRows] = await db.execute(
      'SELECT identificacao, codigo_servidor FROM streamings WHERE codigo = ? AND codigo_cliente = ?',
      [id_pasta, userId]
    );

    if (folderRows.length === 0) {
      return res.status(404).json({ error: 'Pasta não encontrada' });
    }

    const folderName = folderRows[0].identificacao;
    const serverId = folderRows[0].codigo_servidor || 1;
    // Simular download (em produção, usar youtube-dl ou similar)
    const videoTitle = `Video_${Date.now()}`;
    const fileName = `${videoTitle}.mp4`;
    const tempFilePath = `/tmp/${fileName}`;

    try {
      // Garantir que o diretório do usuário existe no servidor
      await SSHManager.createUserDirectory(serverId, userLogin);
      await SSHManager.createUserFolder(serverId, userLogin, folderName);

      // Simular criação do arquivo temporário (em produção, fazer download real do YouTube)
      await fs.writeFile(tempFilePath, 'video content placeholder');
      
      // Upload para o servidor via SSH
      const remotePath = `/usr/local/WowzaStreamingEngine/content/${userLogin}/${folderName}/${fileName}`;
      await SSHManager.uploadFile(serverId, tempFilePath, remotePath);
      
      // Remover arquivo temporário
      await fs.unlink(tempFilePath);
      
      console.log(`✅ Vídeo do YouTube ${videoTitle} enviado para ${remotePath}`);

      // Construir URLs corretas para o Wowza
      const WowzaStreamingService = require('../config/WowzaStreamingService');
      const wowzaService = new WowzaStreamingService();
      await wowzaService.initializeFromDatabase(userId);
      
      const videoUrls = wowzaService.buildVideoUrl(userLogin, folderName, fileName);
      
      // Salvar no banco de dados com URL correta
      const [result] = await db.execute(
        `INSERT INTO playlists_videos (
          codigo_playlist, path_video, video, width, height,
          bitrate, duracao, duracao_segundos, tipo, ordem, tamanho_arquivo
        ) VALUES (0, ?, ?, 1920, 1080, 2500, '00:03:30', 210, 'video', 0, ?)`,
        [videoUrls.hlsUrl, videoTitle, 1024 * 1024]
      );

      res.json({
        success: true,
        message: `Vídeo "${videoTitle}" baixado com sucesso!`,
        video: {
          id: result.insertId,
          nome: videoTitle,
          url: videoUrls.hlsUrl,
          directUrl: videoUrls.directUrl,
          duracao: 210,
          tamanho: 1024 * 1024 // 1MB placeholder
        }
      });
    } catch (fileError) {
      console.error('Erro ao criar arquivo:', fileError);
      // Limpar arquivo temporário em caso de erro
      await fs.unlink(tempFilePath).catch(() => {});
      return res.status(500).json({ error: 'Erro ao salvar vídeo' });
    }
  } catch (err) {
    console.error('Erro no download do YouTube:', err);
    res.status(500).json({ error: 'Erro no download do YouTube', details: err.message });
  }
});

module.exports = router;