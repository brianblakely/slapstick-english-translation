     __  __  ___  __   _ _  __ ___ __  _     __  __  ___   ___  ____  ___
    |  \/  |/ _ \|  \ | | |/ /| __|\ \| | _ |  \/  |/ _ \ / _ \|  _ \| __|
    | |\/| | |_| | |\\| |   | | _|  \_  ||_|| |\/| | |_| | |_| | '-'/| _|
    |_|  |_|\___/|_| \__|_|\_\|___|   |_|   |_|  |_|\___/ \___/|_|\_\| __|
 
    Vers�o: 0.4                                 Plataformas: Windows/Linux

  :: INTRODU��O
  
  O Monkey-Moore � uma ferramenta de busca relativa desenvolvida com o intuito
  de permitir que se fa�a os mais variados tipos de busca com efic�cia e preci-
  s�o. Desenvolvido em C++, o Monkey-Moore suporta buscas em Unicode e � capaz
  de varrer arquivos de v�rios gigabytes em poucos minutos, utilizando apenas
  alguns megabytes de mem�ria.
  O segredo para a efic�cia da ferramenta est� na base do algoritmo de busca,
  baseado no boyer-moore, o mais r�pido algoritmo de busca em cadeias desenvol-
  vido at� hoje. A uni�o de todos esses aspectos tornam o Monkey-Moore uma fer-
  ramenta abrangente e poderosa, sem perder a simplicidade.
  
  :: RECURSOS
  
  O Monkey-Moore suporta buscas bastante customiz�veis, divididas em duas cate-
  gorias b�sicas: busca relativa e busca por valores relativos.
  A busca relativa procura por um conjunto de bytes que possua a mesma diferen-
  �a relativa encontrada na palavra utilizada na busca. Pode-se utilizar curin-
  gas, caracteres do padr�o Unicode, dentre outros recursos avan�ados.
  A busca por valores relativos utiliza-se do mesmo princ�pio de opera��o da
  busca relativa textual, por�m, a entrada deixa de ser uma palavra e passa a
  ser um conjunto de n�meros cuja diferen�a relativa entre os elementos � uti-
  lizada na busca.
  O Monkey-Moore possui algumas otimiza��es para buscas por frases em ASCII,
  como encontrar os valores das letras mai�sculas e min�sculas de forma n�o-
  linear quando procura-se por uma palavra com ambos os tipos de letras.
  Outro recurso importante � a pr�-visualiza��o dos resultados da busca, o que
  ajuda muito na escolha de um resultado correto, e a cria��o automatizada de
  tabelas no formato Thingy, tend-se como base um dos resultados da busca.
  
  :: INTERFACE
  
  A interface do Monkey-Moore foi desenvolvida com base na simplicidade. Todos
  os recursos podem ser acessados atrav�s de uma �nica janela, e op��es avan�a-
  das s�o ocultadas por padr�o.
          ___________________________________________________________ 
         |_�%�_Monkey-Moore 0.4_____________________________|_-|_O|_X|
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
         | | Endere�o (14)| Valores (15)| Visualiza��o Pr�via (16) | |
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
   (2) Permite que voc� procure um arquivo no seu computador.
   (3) Ativa a busca relativa textual.
   (4) Ativa a busca por valores relativos.
   (5) Campo de busca - � onde voc� digita a palavra/conjunto de valores pelo
       qual deseja buscar.
   (6) Inicia a busca.
   (7) Permite o uso de curingas.
   (8) Se a op��o (7) estiver ativada, pode-se definir o caractere curinga
       neste campo.
   (9) Alterna a exibi��o da caixa de op��es avan�adas.
  (10) Ativa a utiliza��o de um conjunto de caracteres (charset) definido pelo
       usu�rio.
  (11) Campo onde o conjunto de caracteres � definido caso a op��o (10) esteja
       ativada.
  (12) Exibe uma lista de conjuntos de caracteres comuns, como a seq��ncia hi-
       ragana padr�o e a seq��ncia katakana padr�o. A op��o escolhida � auto-
       maticamente preenchida no campo (11).
  (13) Alterna a exibi��o de resultados repetidos. Entenda-se resultados repe-
       tidos como os resultados que possuem as mesmas equival�ncias para os ca-
       racteres encontrados.
  (14) Coluna que exibe o endere�o (offset) dos resultados da busca (17).
  (15) Coluna que exibe as equival�ncias encontradas para cada resultado (17).
  (16) Coluna que exibe uma visualiza��o pr�via dos resultados encontrados(17).
       Durante buscas relativas textuais (3), � exibido uma pr�via dos bytes
       encontrados naquela posi��o, utilizando uma tabela com as equival�ncias
       descobertas. Durante buscas por valores relativos (4), � exibido os by-
       tes em hexadecimal, como num editor.
  (17) Resultados da busca.
  (18) Cria uma tabela no formato Thingy para um dos resultados da busca (17).
  (19) Remove os resultados da �ltima busca.
  (20) Permite que o usu�rio escolha algumas op��es e prefer�ncias.
  (21) Exibe informa��es a respeito da ferramenta (vers�o, autor, licen�a).
  (22) Exibe o n�mero de resultados da busca (17), levando em conta a op��o de
       ocultar resultados repetidos.
  
  :: AGRADECIMENTOS
  
  Gostaria de agradecer primeiramente ao Fallen_Soul. O Monkey-Moore talvez nem
  existisse se n�o fosse por ele, por isso ele merece destaque nesta se��o. De-
  pois, gostaria de agradecer a todos os colegas da Trans-Center pelo apoio da-
  do durante o desenvolvimento, principalmente ao Solid_One e ao Ondinha. Por
  fim, gostaria de agradecer � toda a comunidade de romhacking brasileira, que
  testou e aprovou essa ferramenta. A todos voc�s, meu muito obrigado.
  
  -----------------------------------------------------------------------------