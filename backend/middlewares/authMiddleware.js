const jwt = require('jsonwebtoken');
const db = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta_super_segura_aqui';

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de acesso requerido' });
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      let rows = [];
      
      // Buscar baseado no tipo de usuário
      if (decoded.tipo === 'revenda') {
        [rows] = await db.execute(
          'SELECT codigo, nome, email, streamings, espectadores, bitrate, espaco, status, "revenda" as tipo FROM revendas WHERE codigo = ? AND status = 1',
          [decoded.userId]
        );
      } else if (decoded.tipo === 'streaming') {
        [rows] = await db.execute(
          `SELECT 
            s.codigo, 
            s.identificacao as nome, 
            s.email, 
            1 as streamings, 
            s.espectadores, 
            s.bitrate, 
            s.espaco, 
            s.status,
            "streaming" as tipo,
            s.codigo_cliente,
            s.codigo_servidor
           FROM streamings s 
           WHERE s.codigo = ? AND s.status = 1`,
          [decoded.userId]
        );
      }

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Usuário não encontrado ou inativo' });
      }

      const user = rows[0];
      req.user = {
        id: user.codigo,
        nome: user.nome,
        email: user.email,
        tipo: user.tipo || 'streaming', // Valor padrão se não estiver definido
        streamings: user.streamings,
        espectadores: user.espectadores,
        bitrate: user.bitrate,
        espaco: user.espaco,
        codigo_cliente: user.codigo_cliente || null,
        codigo_servidor: user.codigo_servidor || null
      };

      next();
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expirado', expired: true });
      }
      return res.status(401).json({ error: 'Token inválido' });
    }
  } catch (error) {
    console.error('Erro no middleware de autenticação:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

module.exports = authMiddleware;