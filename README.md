# Sistema de Streaming - Completo com Integração WHMCS e Wowza

Este projeto é um sistema completo de gerenciamento de streaming com integração ao WHMCS e servidor Wowza.

## 🚀 Funcionalidades Implementadas

### ✅ Autenticação e Usuários
- Login/Registro com JWT
- Middleware de autenticação
- Integração com WHMCS para criação automática de contas

### ✅ Gerenciamento de Conteúdo
- **Pastas**: Organização de vídeos por pastas
- **Vídeos**: Upload via SSH, listagem e reprodução
- **Playlists**: Criação e gerenciamento de playlists
- **Agendamentos**: Sistema de agendamento de transmissões
- **Comerciais**: Configuração de inserção de comerciais
- **NOVO**: Upload direto para servidor Wowza via SSH
- **NOVO**: Estrutura de pastas automática por usuário
- **NOVO**: Verificação de espaço em disco antes do upload

### ✅ Transmissão ao Vivo
- **Iniciar Transmissão**: Interface completa para iniciar streams
- **Múltiplas Plataformas**: YouTube, Facebook, Instagram, Twitch, etc.
- **Configurações Avançadas**: Logos, qualidade, bitrate
- **Relay RTMP**: Sistema de relay 24/7

### ✅ Análise e Monitoramento
- **Espectadores**: Análise detalhada de audiência
- **Geolocalização**: Mapa mundial de espectadores
- **Estatísticas**: Tempo real e histórico

### ✅ Ferramentas Avançadas
- **Download YouTube**: Baixar vídeos do YouTube
- **Migração FTP**: Migrar vídeos de servidores FTP
- **Players**: Múltiplos tipos de players para diferentes dispositivos

### ✅ Integração Wowza
- Configuração automática de aplicações
- Push para múltiplas plataformas
- Gerenciamento de streams
- Estatísticas em tempo real
- **NOVO**: Upload direto via SSH para servidores Wowza
- **NOVO**: Estrutura de pastas organizada por usuário
- **NOVO**: Gerenciamento automático de diretórios remotos

## 🛠️ Configuração

### Banco de Dados MySQL
```bash
Host: 104.251.209.68
Porta: 35689
Usuário: admin
Senha: Adr1an@
Database: db_SamCast
```

### Servidor Wowza
```bash
Host: 51.222.156.223
Porta: 6980
Usuário: admin
Senha: FK38Ca2SuE6jvJXed97VMn
Aplicação: live
```

### Configuração SSH para Upload de Vídeos
```bash
# O sistema agora usa SSH para enviar arquivos diretamente para o servidor Wowza
# Estrutura de diretórios no servidor:
# /usr/local/WowzaStreamingEngine/content/
#   ├── {usuario1}/
#   │   ├── videos/
#   │   ├── logos/
#   │   ├── recordings/
#   │   └── {pasta1}/
#   │       └── video1.mp4
#   └── {usuario2}/
#       ├── videos/
#       └── {pasta2}/
#           └── video2.mp4
```

### Variáveis de Ambiente
```env
# Banco de dados
DB_HOST=104.251.209.68
DB_PORT=35689
DB_USER=admin
DB_PASSWORD=Adr1an@
DB_NAME=db_SamCast

# Wowza
WOWZA_HOST=51.222.156.223
WOWZA_PORT=6980
WOWZA_USER=admin
WOWZA_PASSWORD=FK38Ca2SuE6jvJXed97VMn
WOWZA_APPLICATION=live

# JWT
JWT_SECRET=sua_chave_secreta_super_segura_aqui
```

## 📡 API Endpoints

### Autenticação
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Registro
- `GET /api/auth/me` - Dados do usuário

### Streaming
- `GET /api/streaming/status` - Status da transmissão
- `POST /api/streaming/start` - Iniciar transmissão
- `POST /api/streaming/stop` - Parar transmissão
- `GET /api/streaming/platforms` - Plataformas disponíveis
- `POST /api/streaming/configure-platform` - Configurar plataforma

### Relay RTMP
- `GET /api/relay/status` - Status do relay
- `POST /api/relay/start` - Iniciar relay
- `POST /api/relay/stop` - Parar relay
- `POST /api/relay/validate-url` - Validar URL

### Conteúdo
- `GET /api/folders` - Listar pastas
- `GET /api/videos` - Listar vídeos
- `GET /api/playlists` - Listar playlists
- `GET /api/agendamentos` - Listar agendamentos
- `GET /api/comerciais` - Configurações de comerciais

### Ferramentas
- `POST /api/downloadyoutube` - Download do YouTube
- `POST /api/ftp/connect` - Conectar FTP
- `POST /api/ftp/migrate` - Migrar vídeos FTP

### WHMCS Integration
- `POST /api/whmcs/webhook` - Webhook do WHMCS
- `GET /api/whmcs/test` - Teste da integração

## 🔧 Como Executar

### Pré-requisitos
- Node.js 18+
- Acesso ao banco MySQL configurado
- Servidor Wowza configurado
- **NOVO**: Acesso SSH aos servidores Wowza

### Instalação
```bash
# Instalar dependências
npm install

# Instalar dependências do backend
cd backend
npm install
cd ..
```

### Executar
```bash
# Executar frontend e backend
npm run dev

# Ou separadamente:
npm run dev:frontend  # Frontend na porta 3000
npm run dev:backend   # Backend na porta 3001
```

### URLs
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:3001/api
- **Health Check:** http://localhost:3001/api/health

### URLs do Sistema

Após o deploy, o sistema estará disponível em:

- **Frontend:** http://samhost.wcore.com.br
- **Backend API:** http://samhost.wcore.com.br:3001/api
- **Health Check:** http://samhost.wcore.com.br:3001/api/health
- **Streaming RTMP:** rtmp://samhost.wcore.com.br:1935/samhost
- **Streaming HLS:** http://samhost.wcore.com.br:1935/samhost/{usuario}_live/playlist.m3u8
- **Vídeos VOD:** Acessados via porta 6980 (gerenciado pelo backend)
- **Streams ao vivo:** Porta 1935 para RTMP/HLS

## 🔗 Integração WHMCS

### Configuração do Módulo WHMCS
1. Copie o arquivo `stmvideoadvance.php` para `/modules/servers/`
2. Configure o servidor no WHMCS:
   - **Name:** Nome do servidor
   - **Hostname:** URL da API (ex: http://localhost:3001)
   - **IP Address:** Chave API (não usado atualmente)

### Webhook Configuration
Configure o webhook no WHMCS para apontar para:
```
http://seu-dominio.com/api/whmcs/webhook
```

### Produtos WHMCS
Configure os produtos com as seguintes opções:
- **Espectadores:** Número máximo de espectadores
- **Bitrate:** Limite de bitrate
- **Espaço FTP:** Espaço em megabytes
- **Aplicação:** live, tvstation, vod, ipcamera
- **Idioma:** pt-br, en-us, es

## 🎯 Funcionalidades por Página

### Dashboard
- Visão geral das transmissões
- Player universal integrado
- Estatísticas em tempo real
- Atalhos para principais funcionalidades

### Iniciar Transmissão
- Configuração de múltiplas plataformas
- Upload e gerenciamento de logos
- Configurações avançadas de transmissão
- Preview em tempo real

### Gerenciar Vídeos
- Upload de vídeos com drag & drop
- Organização por pastas
- Player integrado
- Suporte a múltiplos formatos

### Playlists
- Criação com drag & drop
- Reordenação de vídeos
- Preview de playlists
- Integração com agendamentos

### Agendamentos
- Calendário visual
- Agendamento recorrente
- Múltiplas frequências
- Playlist de finalização

### Espectadores
- Mapa mundial em tempo real
- Análise por país/dispositivo
- Histórico de audiência
- Exportação de dados

### Players
- Player universal responsivo
- Múltiplos tipos de incorporação
- Configurações personalizáveis
- Códigos prontos para uso

## 🔒 Segurança

- Autenticação JWT
- Validação de propriedade de recursos
- Sanitização de uploads
- Rate limiting (recomendado para produção)
- CORS configurado

## 📊 Monitoramento

- Health check endpoint
- Logs estruturados
- Métricas de performance
- Alertas de erro (recomendado para produção)

## 🚀 Deploy

### Produção
1. Configure as variáveis de ambiente
2. Execute as migrações do banco
3. Configure o servidor web (Nginx/Apache)
4. Configure SSL/TLS
5. Configure monitoramento

### Docker (Opcional)
```dockerfile
# Dockerfile exemplo para produção
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

## 📝 Próximos Passos

1. ✅ Upload direto via SSH para Wowza
2. ✅ Estrutura de pastas organizada por usuário
3. ✅ Gerenciamento automático de diretórios remotos
4. ✅ Verificação de espaço em disco
5. ✅ Implementar cache Redis
6. ✅ Adicionar testes automatizados
7. ✅ Configurar CI/CD
8. ✅ Implementar logs estruturados
9. ✅ Adicionar métricas de performance
10. ✅ Configurar backup automático

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo LICENSE para mais detalhes.