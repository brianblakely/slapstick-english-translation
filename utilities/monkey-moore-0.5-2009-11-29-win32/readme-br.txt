     __  __  ___  __   _ _  __ ___ __  _     __  __  ___   ___  ____  ___
    |  \/  |/ _ \|  \ | | |/ /| __|\ \| | _ |  \/  |/ _ \ / _ \|  _ \| __|
    | |\/| | |_| | |\\| |   | | _|  \_  ||_|| |\/| | |_| | |_| | '-'/| _|
    |_|  |_|\___/|_| \__|_|\_\|___|   |_|   |_|  |_|\___/ \___/|_|\_\| __|
 
    Versão: 0.4                                 Plataformas: Windows/Linux

  :: INTRODUÇÃO
  
  O Monkey-Moore é uma ferramenta de busca relativa desenvolvida com o intuito
  de permitir que se faça os mais variados tipos de busca com eficácia e preci-
  são. Desenvolvido em C++, o Monkey-Moore suporta buscas em Unicode e é capaz
  de varrer arquivos de vários gigabytes em poucos minutos, utilizando apenas
  alguns megabytes de memória.
  O segredo para a eficácia da ferramenta está na base do algoritmo de busca,
  baseado no boyer-moore, o mais rápido algoritmo de busca em cadeias desenvol-
  vido até hoje. A união de todos esses aspectos tornam o Monkey-Moore uma fer-
  ramenta abrangente e poderosa, sem perder a simplicidade.
  
  :: RECURSOS
  
  O Monkey-Moore suporta buscas bastante customizáveis, divididas em duas cate-
  gorias básicas: busca relativa e busca por valores relativos.
  A busca relativa procura por um conjunto de bytes que possua a mesma diferen-
  ça relativa encontrada na palavra utilizada na busca. Pode-se utilizar curin-
  gas, caracteres do padrão Unicode, dentre outros recursos avançados.
  A busca por valores relativos utiliza-se do mesmo princípio de operação da
  busca relativa textual, porém, a entrada deixa de ser uma palavra e passa a
  ser um conjunto de números cuja diferença relativa entre os elementos é uti-
  lizada na busca.
  O Monkey-Moore possui algumas otimizações para buscas por frases em ASCII,
  como encontrar os valores das letras maiúsculas e minúsculas de forma não-
  linear quando procura-se por uma palavra com ambos os tipos de letras.
  Outro recurso importante é a pré-visualização dos resultados da busca, o que
  ajuda muito na escolha de um resultado correto, e a criação automatizada de
  tabelas no formato Thingy, tend-se como base um dos resultados da busca.
  
  :: INTERFACE
  
  A interface do Monkey-Moore foi desenvolvida com base na simplicidade. Todos
  os recursos podem ser acessados através de uma única janela, e opções avança-
  das são ocultadas por padrão.
          ___________________________________________________________ 
         |_°%°_Monkey-Moore 0.4_____________________________|_-|_O|_X|
         |  __________________________________________________   __  |
         | |1_________________________________________________| |2_| |
         |                                                           |
         | o Busca relativa (3) o Busca por valores relativos (4)    |
         |  __________________________________________________   __  |
         | |5_________________________________________________| |6_| |
         | [_] Usar curingas (7) [8_]                           |9_| |
         |                            ________________________   __  |
         | [_] Definir charset: (10) |11______________________| |12| |
         |                                                           |
         | [_] Mostrar resultados repetidos (13)                     |
         |  _______________________________________________________  |
         | | Endereço (14)| Valores (15)| Visualização Prévia (16) | |
         | |-------------------------------------------------------| |
         | |                                                       | |
         | |                        (17)                           | |
         | |                                                       | |
         | |                                                       | |
         | |_______________________________________________________| |
         |  ______   ______   __   __                                |
         | |__18__| |__19__| |20| |21|         Resultados:     0 (22)|
         |___________________________________________________________|

   (1) Nome do arquivo onde deseja-se fazer a busca.
   (2) Permite que você procure um arquivo no seu computador.
   (3) Ativa a busca relativa textual.
   (4) Ativa a busca por valores relativos.
   (5) Campo de busca - é onde você digita a palavra/conjunto de valores pelo
       qual deseja buscar.
   (6) Inicia a busca.
   (7) Permite o uso de curingas.
   (8) Se a opção (7) estiver ativada, pode-se definir o caractere curinga
       neste campo.
   (9) Alterna a exibição da caixa de opções avançadas.
  (10) Ativa a utilização de um conjunto de caracteres (charset) definido pelo
       usuário.
  (11) Campo onde o conjunto de caracteres é definido caso a opção (10) esteja
       ativada.
  (12) Exibe uma lista de conjuntos de caracteres comuns, como a seqüência hi-
       ragana padrão e a seqüência katakana padrão. A opção escolhida é auto-
       maticamente preenchida no campo (11).
  (13) Alterna a exibição de resultados repetidos. Entenda-se resultados repe-
       tidos como os resultados que possuem as mesmas equivalências para os ca-
       racteres encontrados.
  (14) Coluna que exibe o endereço (offset) dos resultados da busca (17).
  (15) Coluna que exibe as equivalências encontradas para cada resultado (17).
  (16) Coluna que exibe uma visualização prévia dos resultados encontrados(17).
       Durante buscas relativas textuais (3), é exibido uma prévia dos bytes
       encontrados naquela posição, utilizando uma tabela com as equivalências
       descobertas. Durante buscas por valores relativos (4), é exibido os by-
       tes em hexadecimal, como num editor.
  (17) Resultados da busca.
  (18) Cria uma tabela no formato Thingy para um dos resultados da busca (17).
  (19) Remove os resultados da última busca.
  (20) Permite que o usuário escolha algumas opções e preferências.
  (21) Exibe informações a respeito da ferramenta (versão, autor, licença).
  (22) Exibe o número de resultados da busca (17), levando em conta a opção de
       ocultar resultados repetidos.
  
  :: AGRADECIMENTOS
  
  Gostaria de agradecer primeiramente ao Fallen_Soul. O Monkey-Moore talvez nem
  existisse se não fosse por ele, por isso ele merece destaque nesta seção. De-
  pois, gostaria de agradecer a todos os colegas da Trans-Center pelo apoio da-
  do durante o desenvolvimento, principalmente ao Solid_One e ao Ondinha. Por
  fim, gostaria de agradecer à toda a comunidade de romhacking brasileira, que
  testou e aprovou essa ferramenta. A todos vocês, meu muito obrigado.
  
  -----------------------------------------------------------------------------