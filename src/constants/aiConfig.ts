
export const AI_CONFIG = {
  mainPrompt: `ENCARTE DIGITAL UNIVERSAL - MULTI-NEGÓCIO v4.0

1. CONFIGURAÇÃO DA LOJA (EDITÁVEL PARA QUALQUER NEGÓCIO)
O sistema suporta múltiplos segmentos como Farmácia (DROGALIDER), Mercado (SUPERMERCADO BOM PREÇO), Mecânica (AUTO MECÂNICA RÁPIDA) e Padaria (PADARIA SÃO JOÃO).
Campos de configuração: NOME, SUBNOME, SLOGAN, ENDEREÇO, WHATSAPP, INSTAGRAM, FUNCIONAMENTO, DIFERENCIAIS (ex: Entrega Grátis, Orçamento Grátis, etc).

2. IDENTIDADE VISUAL PERSONALIZÁVEL
CORES PRINCIPAIS:
- Cor 1 (Principal/Fundo Topo): [#0047AB] Azul Royal
- Cor 2 (Escura/Fundo Rodapé): [#001F3F] Azul Escuro
- Cor 3 (Destaques/Ofertas): [#00A86B] Verde
- Cor 4 (Preços/Promoções): [#FFD700] Amarelo
- Cor 5 (Descontos/Urgência): [#FF4500] Laranja
- Cor 6 (Fundo Produtos/Texto): [#FFFFFF] Branco

SUGESTÕES POR SEGMENTO:
- Farmácia: Azul + Verde + Branco
- Mercado: Vermelho #E60012 + Amarelo + Branco
- Mecânica: Laranja #FF6B00 + Preto #1A1A1A + Cinza
- Padaria: Marrom #8B4513 + Dourado #DAA520 + Creme #FFF8DC
- Outros: Pet Shop (Verde/Laranja), Loja Roupas (Rosa/Preto), Açougue (Vermelho Escuro/Preto), Ótica (Azul Claro/Prata), Restaurante (Vermelho/Dourado).

TIPOGRAFIA:
- Títulos: Montserrat Black (grande, negrito)
- Preços: Oswald Bold (muito grande, cor de destaque)
- Textos: Open Sans (médio, legível)
- Legais: Open Sans Regular (pequeno)

3. CAMPANHA (EDITÁVEL)
TÍTULO: [SUPER OFERTAS], SUBTÍTULO: [DA SEMANA], VALIDADE: [Válido até DD/MM/AAAA], DESTAQUE: [ATÉ XX% OFF, COMPRE X LEVE Y, FRETE GRÁTIS].

4. PRODUTOS (TEMPLATE UNIVERSAL - 4 ITENS)
CADA PRODUTO: Nome, Descrição Curta, Marca/Categoria, Preço DE (riscado), Preço POR (destaque), Economia (valor ou %).

5. ESTRUTURA DO ENCARTE (3 SEÇÕES FIXAS)
FORMATO: Story vertical 9:16 (1080 x 1920 pixels).
[SEÇÃO 1: TOPO - 20% da altura]
- FUNDO: Cor Principal sólida (sem degradê).
- ELEMENTOS: Logo/Ícone do segmento, Nome da Loja, Subnome, Título da Campanha, Período, Selo de Destaque no topo direito.
[SEÇÃO 2: MEIO - 60% da altura]
- FUNDO: Cor clara sólida (#FFFFFF ou tom claro da paleta).
- LAYOUT: Grade 2x2 (2 colunas, 2 linhas).
- CARDS: Cada card contém imagem fotorealista do produto, badge de desconto, nome em maiúsculo e negrito, descrição em 2 linhas, preço DE (menor) e preço POR (muito grande).
[SEÇÃO 3: RODAPÉ - 20% da altura]
- FUNDO: Cor Escura sólida.
- ELEMENTOS: Nome da loja (branco, grande), Slogan, Endereço completo, WhatsApp (verde ou branco), Instagram, Funcionamento, Badges de Diferenciais.

6. ÍCONES/SÍMBOLOS POR SEGMENTO
- Farmácia: Cruz farmacêutica (vermelha/branca)
- Mercado: Carrinho de compras + sacola
- Mecânica: Chave inglesa + volante
- Padaria: Pão + trigo
- Açougue: Faca de chef + carne
- Pet Shop: Pata de animal + coração
- Loja Roupas: Cabide + etiqueta
- Ótica: Óculos + olho
- Material Construção: Tijolo + martelo
- Restaurante: Garfo + faca + prato

7. REGRAS ABSOLUTAS (UNIVERSAIS)
OBRIGATÓRIO: TODOS os textos em PORTUGUÊS DO BRASIL, preços em REAIS (R$), telefone no formato brasileiro, layout limpo sem elementos técnicos, bordas preenchidas com cor sólida.
PROIBIDO: Qualquer palavra em INGLÊS, medidas técnicas (px, dpi, cm), réguas, guias, linhas de corte, números de página ou marcações de template.

8. COMANDO FINAL DE GERAÇÃO (TEMPLATE)
"Criar encarte publicitário completo para [NOME DA LOJA], formato story vertical 9:16, resolução [HD/4K], identidade visual com cores [COR1], [COR2] e [COR3], [X] produtos com fotos realistas, todos os textos em PORTUGUÊS DO BRASIL, WhatsApp [TELEFONE], layout limpo sem elementos técnicos nas bordas, pronto para publicação imediata no Instagram Stories, WhatsApp Status e Facebook Stories."`,
  technicalPrompts: [],
  model: "gpt-4o",
  imageModel: "dall-e-3",
  temperature: 0.7,
  maxTokens: 2500
};
