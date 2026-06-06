# Funcionalidades do BemCicatri

## Geral

- Landing page institucional com navegação interna e apresentação do projeto.
- Design responsivo para desktop e celular.
- Uso de ícones, ilustrações SVG e animações para promover a identidade do projeto.
- Favicon e carregamento de fontes do Google Fonts.

## Navegação e apresentação

- Menu fixo com links para as seções: Problema, Projeto, Plataforma, Sobre.
- Botões de chamada para ação: acessar plataforma, criar conta, fazer login.
- Seções explicativas sobre diabetes, cicatrização, barbatimão e proposta científica.
- Cards de visualização de funcionalidades com blocos “bloqueados” que direcionam para login.

## Autenticação

- Página de login com campos de e-mail e senha.
- Página de cadastro com:
  - nome e sobrenome;
  - e-mail;
  - tipo de perfil (Aluno, Professor, Avaliador, Visitante);
  - telefone com máscara;
  - senha e confirmação de senha;
  - validação de força de senha;
  - aceite de termos de uso.
- Mensagens de erro e sucesso na autenticação.
- Persistência de sessão via `sessionStorage`.

## Dashboard do usuário

- Área principal com layout tipo dashboard.
- Sidebar de navegação com as seções:
  - Início
  - Laboratório Virtual
  - Simulador de Cicatrização
  - Diário de Pesquisa
  - Mapa do Impacto
  - Quiz Científico
  - Calculadora de Risco
  - Pacientes
  - Sobre o Projeto
  - Configurações
- Menu responsivo para telas menores.
- Topbar com saudação ao usuário.
- Área de boas-vindas com resumo rápido de estatísticas.

## Laboratório Virtual

- Seleção de ingredientes ativos: álcool de cereais, barbatimão em pó, glicerina, óleo de coco, amido de milho.
- Entrada de quantidade para cada ingrediente.
- Mistura da fórmula e visualização de resultados no frasco.
- Exibição de pH estimado e faixa ideal.
- Placa de processo científico com passos da formulação.
- Card de estabilidade e checklist de qualidade.
- Painel de informações detalhadas por ingrediente.

## Microscopia Virtual

- Seletor de paciente para análise microscópica.
- Visualização de paciente com informações clínicas.
- Canvas comparativo de microscopia antes e depois do tratamento.
- Indicadores de resultados de simulação e métricas.

## Simulador de Cicatrização

- Comparação entre controle e tratamento.
- Simulação da evolução da ferida ao longo do tempo.
- Mapa de eficácia e controle de variáveis clínicas.
- Possibilidade de autoconfiança/auto-play e reset da simulação.
- Registro de resultados no histórico.

## Diário de Pesquisa

- Linha do tempo com as 5 fases do projeto.
- Documentos de acompanhamento científico do trabalho.
- Texto de relato em formato de diário.

## Mapa do Impacto

- Uso de Leaflet para mapa interativo.
- Visualização de dados epidemiológicos e impacto regional.

## Quiz Científico

- Perguntas sobre diabetes, cicatrização e propriedades dos ingredientes.
- Feedback imediato de respostas corretas e incorretas.
- Resultado final do quiz para o usuário.

## Calculadora de Risco

- Ferramenta de avaliação de risco de úlceras diabéticas.
- Entrada de dados clínicos e exibição de resultado de risco.

## Gestão de Pacientes

- Cadastro de pacientes com informações clínicas:
  - nome;
  - idade;
  - diagnóstico de diabetes;
  - tipo de ferida;
  - telefone;
  - classificação de Wagner;
  - histórico de evolução;
  - HbA1c;
  - IMC.
- Listagem de pacientes.
- Filtro e busca rápidos.
- Tela de detalhes do paciente com histórico.
- Adição de novas evoluções clínicas.
- Dashboard com lista rápida de pacientes e contagem.

## Configurações e perfil

- Edição de perfil do usuário (nome, sobrenome, telefone).
- Preferências de notificação.
- Alteração de senha.

## Armazenamento e fallback offline

- Detecção de backend local em `localhost:3000` e `localhost:3001`.
- Uso de `localStorage` como fallback quando backend não estiver disponível.
- Atualização de estado de conexão com indicador visual.
- Armazenamento local de:
  - usuários;
  - pacientes;
  - histórico de login;
  - estado do simulador;
  - dados de eficácia.

## Outros recursos

- Sistema de toasts e alertas visuais.
- Animações suaves de entrada e destaque.
- Tratamento de erros com fallback inteligente.
- Estrutura modular para facilitar hospedagem.
