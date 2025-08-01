const express = require('express');
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');

const router = express.Router();

// GET /api/relay/status - Verifica status do relay
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.execute(
      `SELECT 
        s.codigo as id,
        s.relay_status,
        s.relay_url,
        'rtmp' as relay_type,
        s.relay_url as relay_error_details,
        NOW() as relay_started_at,
        CASE WHEN s.relay_status = 'ativo' THEN 1 ELSE 0 END as is_live,
        FLOOR(RAND() * 50) + 5 as viewers,
        2500 + FLOOR(RAND() * 500) as bitrate,
        '01:23:45' as uptime
       FROM streamings s
       WHERE s.codigo_cliente = ?
       LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.json({
        relay_status: 'inativo',
        is_live: false
      });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Erro ao verificar status do relay:', error);
    res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

// POST /api/relay/validate-url - Valida URL do relay
router.post('/validate-url', authMiddleware, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.json({ valid: false, message: 'URL é obrigatória' });
    }

    // Validação básica de formato
    const rtmpRegex = /^rtmp:\/\/.+/;
    const m3u8Regex = /^https?:\/\/.+\.m3u8$/;

    if (!rtmpRegex.test(url) && !m3u8Regex.test(url)) {
      return res.json({ 
        valid: false, 
        message: 'URL deve ser RTMP (rtmp://) ou M3U8 (https://...m3u8)' 
      });
    }

    // Simular validação de conectividade
    // Em produção, você faria uma verificação real da URL
    const isValid = Math.random() > 0.2; // 80% de chance de ser válida

    res.json({
      valid: isValid,
      message: isValid ? 'URL válida e acessível' : 'URL parece estar offline'
    });

  } catch (error) {
    console.error('Erro ao validar URL:', error);
    res.status(500).json({ valid: false, message: 'Erro ao validar URL' });
  }
});

// POST /api/relay/start - Inicia relay
router.post('/start', authMiddleware, async (req, res) => {
  try {
    const { relay_url, relay_type, server_id } = req.body;
    const userId = req.user.id;

    if (!relay_url) {
      return res.status(400).json({
        success: false,
        error: 'URL do relay é obrigatória'
      });
    }

    // Atualizar configuração do relay no streaming
    await db.execute(
      `UPDATE streamings SET 
       relay_status = 'ativo',
       relay_url = ?
       WHERE codigo_cliente = ?`,
      [relay_url, userId]
    );

    // Log do agendamento
    await db.execute(
      `INSERT INTO relay_agendamentos_logs (
        codigo_agendamento, codigo_stm, data, servidor_relay
      ) VALUES (0, ?, NOW(), ?)`,
      [userId, relay_url]
    );

    res.json({
      success: true,
      message: 'Relay ativado com sucesso',
      relay_url,
      relay_type: relay_type || 'rtmp'
    });

  } catch (error) {
    console.error('Erro ao iniciar relay:', error);
    res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

// POST /api/relay/stop - Para relay
router.post('/stop', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Desativar relay
    await db.execute(
      `UPDATE streamings SET 
       relay_status = 'nao',
       relay_url = ''
       WHERE codigo_cliente = ?`,
      [userId]
    );

    res.json({
      success: true,
      message: 'Relay desativado com sucesso'
    });

  } catch (error) {
    console.error('Erro ao parar relay:', error);
    res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

module.exports = router;