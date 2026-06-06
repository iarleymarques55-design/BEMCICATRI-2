# 🚀 Guia de Hospedagem - BemCicatri no Railway

## Pré-requisitos
- Conta no [Railway.app](https://railway.app/) (crie em 2 minutos)
- GitHub (para deploy automático, ou faça upload manual)
- Projeto verificado e funcionando localmente

---

## 📋 Passo 1: Preparar o Projeto Localmente

### 1.1 Verificar package.json
✅ Já configurado com:
- `"start": "node public/server.js"`
- Dependências: express, pg, cors, dotenv, nodemailer, email-validator

### 1.2 Criar arquivo .env para produção
Crie `.env.production` na raiz do projeto:
```
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=sua_senha
DB_NAME=bemcicatri
API_URL=https://seu-app.railway.app
NODE_ENV=production
```

---

## 🚀 Passo 2: Deploy no Railway

### Opção A: Via GitHub (Recomendado)
1. **Fazer push do projeto para GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: BemCicatri"
   git branch -M main
   git remote add origin https://github.com/seu-usuario/bemcicatri.git
   git push -u origin main
   ```

2. **Entrar no Railway** → [railway.app](https://railway.app/)

3. **Criar novo projeto**
   - Clique em "New Project"
   - Selecione "Deploy from GitHub"
   - Conecte sua conta GitHub
   - Selecione o repositório `bemcicatri`

### Opção B: Upload Manual
1. Entre no [Railway.app](https://railway.app/)
2. Clique "New Project" → "Deploy from Repo"
3. Selecione "Create from a template"
4. Escolha "Node.js + PostgreSQL"
5. Faça upload dos arquivos

---

## 🗄️ Passo 3: Adicionar Banco de Dados PostgreSQL

1. No Dashboard do Railway:
   - Clique no botão "+" → "Add Service"
   - Procure por "PostgreSQL"
   - Clique "Add PostgreSQL"

2. O Railway criará automaticamente:
   - **Host**: do.railway.app (ou semelhante)
   - **Port**: 5432
   - **User**: postgres
   - **Password**: (gerado automaticamente)
   - **Database**: railway

3. Copiar as credenciais e verificar se aparecem como Variables

---

## ⚙️ Passo 4: Configurar Variáveis de Ambiente

1. No Dashboard → Seu Projeto → Aba "Variables"
2. Adicione as variáveis necessárias:
   ```
   PORT=3000
   DB_HOST=[do.railway.app]
   DB_USER=[usuario_do_railway]
   DB_PASSWORD=[senha_do_railway]
   DB_NAME=[database_name]
   NODE_ENV=production
   API_URL=https://seu-app-railway.railway.app
   ```

3. Para Email (opcional):
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=seu@gmail.com
   SMTP_PASS=[sua senha de app]
   SMTP_SECURE=false
   SMTP_FROM="BemCicatri <seu@gmail.com>"
   ```

---

## 🔗 Passo 5: Conectar o App ao Banco

Na Railway, o sistema faz isso automaticamente se:
1. ✅ server.js usa `process.env.DB_HOST`, etc
2. ✅ Seu código está procurando as variáveis de ambiente

**Verificação**: No Logs do Railway, você deve ver:
```
✅ Conectado ao banco de dados PostgreSQL
✅ Servidor rodando na porta 3000
```

---

## ✅ Passo 6: Deploy

1. **Se usou GitHub**: O Deploy acontece automaticamente quando faz push
2. **Se usou upload**: Clique "Deploy"
3. Aguarde a mensagem "Deployment successful"

---

## 🌐 Passo 7: Acessar o App

Seu app estará disponível em:
```
https://seu-projeto.railway.app
```

O Railway fornece uma URL automaticamente na aba "Settings"

---

## 🔍 Verificação e Testes

1. **Verificar status**:
   - Aba "Deployments" → deve estar "Running"
   - Aba "Logs" → procure por erros

2. **Testar a API**:
   ```bash
   curl https://seu-projeto.railway.app/api/saude
   ```

3. **Testar no navegador**:
   - Abra `https://seu-projeto.railway.app`
   - Verifique se carrega o index.html

---

## 🐛 Troubleshooting

### Erro: "Cannot find module 'express'"
- Execute na raiz: `npm install`
- Faça commit: `git add . && git commit -m "Update dependencies"`

### Erro: "Connection refused"
- Verifique as credenciais do BD em "Variables"
- Aguarde 2-3 minutos após criar o PostgreSQL
- Reinicie o Deploy (clique no ícone de reload)

### App não inicia
- Verifique "Logs" no Railway
- Procure por erros de porta ou conexão
- Certifique que `PORT=3000` está definido

### PostgreSQL não conecta
- Verifique se o serviço PostgreSQL está "Running"
- Confirme que variáveis estão corretas
- Teste com Railway CLI: `railway shell`

---

## 📊 Custo Estimado (Railway)

- **App Node.js**: $5/mês ou free tier
- **PostgreSQL**: Incluído no plano
- **Primeira tentativa**: **GRATUITO** (crédito de US$5)

---

## 📚 Recursos Úteis

- [Documentação Railway](https://docs.railway.app/)
- [Railway CLI Reference](https://docs.railway.app/cli/)
- [Railway PostgreSQL Guide](https://docs.railway.app/plugins/postgresql)

---

**🎉 Pronto! Seu BemCicatri estará no ar!**
