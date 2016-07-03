+-----------------------------------------+
| romjuice v2.2, written by prez@lfx.org. |
| released may 30th, 2001.                |
+-----------------------------------------+

table of contents:
 1. what is it?
 2. command-line usage  *updated*
 3. table file format
 4. thanks

1. what is it?

   romjuice is an opensource command-line based script dumper. it could prove
   useful for dumping dialogue text out of a videogame for modification or
   translation. it currently supports upto 4 byte hexidecimal table entries,
   and (basically) unrestricted string entries length. table format is like
   that of dos/windows-based tools (ie. thingy, gizmo, hexposure, etc.), but
   like those tools, has it's own special functions in the table system.

   the idea of romjuice is to provide a very functional script dumper that
   is also easily modified to meet the needs of a particular individual or
   group. romjuice was originally programmed to meet the needs of a few
   individuals i know who needed a custom script dumper for certain
   translation projects. version 2 has been rewritten for public use, and
   lacks many of those custom features. i do hope to re-implement those
   features in the future (including kanji arrays (ala. burning heroes, popful
   mail, etc.), and multiple table file switching (ala. super robot wars,
   jesus, etc)).


2. command-line usage

   note: the binary included is a linux binary.
   on other unix systems you should recompile the binary. instructions are
   provided in the INSTALL file.

   running romjuice with no arguments will return something like this:

   romjuice v2.1, written by prez@lfx.org
   usage: ./romjuice <rom.bin> <table.tbl> <start addr> <end addr> <output.txt>
                     [options..]
   
   now i'll explain what each of these values is:

   <rom.bin>
     this is the filename of the rom you want to dump text out of.

   <table.tbl>
     this is the table file that contains a binary to ascii conversion table.

   <start addr>
     the address to start dumping from, in hexidecimal. (example '1A000')

   <end addr>
     the address to stop dumping at, in hexidecimal. (example '2BFFF')
     incase you're wondering, the byte at 2BFFF would be dumped.

   <output.txt>
     the text file to dump the script into. if this file exists, it will be
     over-written.
     
   [options..]
     to make the program easier to operate from the command-line, i've also
     implemented dynamic options for the command-line. you can add these to
     the command-line in any order, as long as they come after the static
     options mentioned above. here are a list of them.

     -o
         turn script commenting 'off'

         commenting is on by default, but if the script you're extracting is
         going to be the same one reinserted, you might want this off. this
         just puts a semi-colon and space at the beginning of each line, which
         is useful if you're translating from one language to another, since
         you can easily seperate the dumped langauge from the language being
         reinserted. plus tom (aka. dds/shivalva), a good friend of mine who
         translates, loves this feature. 
     

     -h "<format>"
         specify hexidecimal output format.
         
         i've implemented this feature for people using versions of gizmo
         that use the ~%02X~ formatting, or people who wish to mute out
         all hexidecimal output. keep in mind you can format your hexidecimal
         output however you like. a few examples are:

         -h "~%02X~"    would output like ~xx~.
         -h ""          would mute all output.
         -h "<$%02X>"   would output like <$xx>, which is default.

         
     -t <filename>
         secondary table file.    
     
         specify a second table file for the table-file swapping function.
         for more information, read about the font table selection feature
         in the table file format documentation.
         
   i'm really too lazy to document error messages, since there's no reason
   you should run into them unless you're an idiot :p (or if you run out of
          memory, in which case i take that back) if something goes wrong
   and it's not obvious what happened, drop me and e-mail at prez@lfx.org. it's
   important that you report bugs, and not assume that they'll be reported
   by someone else. the important bugs i've fixed so far were almost impossible
   to reduplicate, and likely wouldn't have been run into by anyone else.
     
   
3. table file format

   this is simple enough. like every other rom hacking oriented hex editor or
   script dumper, it's a simple:

   hexidecimal value=string value

   format. for example:

   00=A
   01=B
   02=C

   but you can also do multi-byte entries like this:

   12345678=A
   
   and multi-character substring entries like this:

   00=Test

   and mix them up like this:

   1234=Test

   standard enough, i know. but there is more. there are also a set of
   formatting control characters you can use in your string values, these
   are (at current):

   \n   line-break. if commenting is on, the next line will be commented.
   \r   hard return. even if commenting is on, next line won't be commented.

   i plan on adding more of these in the future, since the old
   version of romjuice had tons, including indexing information, etc.

   now many script dumpers have values known as "string break", and if you
   are wondering where it is, there isn't one. for flexablity purposes, you
   can just use script formatting values like '\n' to do something like this:

   FF=\n<end string>\r\r

   this will produce something like this:

   ; <end string>


   and two lines with no commenting to enter the translation.

   also, there are a few special table entries you can use to do special
   things while dumping your scripts, they are:

     multi-byte hexidecimal output:

       if you want to print 'x' following bytes after a certain byte, as
       hexidecimal output, you can do this with:

       $FF=1

       if FF is the the trigger byte, and 1 is how many bytes afterwards we
       want to print as hexidecimal. keep in mind, the argument is a
       decimal number, not hexidecimal. with that in mind, the following
       WILL NOT work:

       $FF=A

       in the case that you do this, if i know my code well enough, it simply
       won't do anything, but i mean, it's likely it might do something evil
       too.
     
       
     kanji array encoding:

       kanji array encoding is when an array of kanji bytes are indicated
       with a trigger, and then "index bytes", following. in most games,
       kanji are stored as dual-byte values, such as:

       C0 12

       to save space, some game developers used kanji array encoding for
       saving space with long lists of kanji in a row. a normal kanji array
       string might look like this:

       C2 12 34 56   
       
       which would be the equivilant to:

       C0 12 C0 34 C0 56

       C1 would be a trigger for the 2 following bytes, C2 would be 3, C3
       would be 4, etc. 
       
       a few games that use this space saving technique are burning heroes,
       la wares, and popful mail. now, if you want to support kanji array
       encoding in your script dump, make a table entry like this:

       @C1=2,C000

       where C1 is the kanji array trigger byte, 2 is how many bytes following
       it are to be printed as kanji, and C000 is the value to add to those
       bytes to get their respective kanji value in the table. keep in mind,
       if you have the above in your table, and the following is in the rom:

       C1 12 34 56

       it will be expecting that there is a table entry for C012, C034, and
       C056. i hope the method for kanji array encoding that i've implemented
       will meet most peoples needs.
     
       
     dual table files:

       the dual table file support that's been implemented in romjuice should
       prove useful for dumping the script in a game that uses font table
       selection (ie. jesus (famicom), super robot wars (gameboy)) to switch
       back and forth from hiragana to katakana. using it is simple. create
       two table files, one is the default font table (ie. hiragana), and the 
       second is for the font table that is switched to (ie. katakana). then,
       in the first table file, add a entry like follows:

       !F8

       where F8 is the trigger byte to switch from hiragana to katakana. in
       the second table file, you should have a similar entry, for the byte
       used to switch from katakana to hiragana. it's important to note that
       even if the same byte is used to switch back and forth, you need to
       have the trigger byte line in BOTH table files. if you don't, you'll
       switch from one table file to the other, and never be able to get back
       to the first table file.

       also, it's important to specify the second table file on the
       command-line, like follows:

       -t second.tbl

       you should put it after all the static command-line options. if you
       don't specify the second table file, the program will simply ignore
       table swapping.
       
4. thanks to

   i try to give a little word of thanks to people who deserve it when i have
   the chance, and i think this is a good chance.

   thanks goes to:

   tom (aka. shivalva/dds)
     for everything. 

   mdw2
     providing the dos binaries and fairly extensive testing ;)

   haws, desrt, klarth, admin-x-.
     proofing my code after the first release and tipping me off to
     potentially serious problems :) (see CHANGELOG for a list :)
     
   kitsune sniper
     important bug reports, and feature suggestions.

   dark force, sheex.
     great feature suggestions.
     
   everyone else (aka. #gumcode, #romhaven, #oldnes)
     aw come on, i can't mention you all. :)

