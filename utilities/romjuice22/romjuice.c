/* romjuice v2.2
 * written by prez@lfx.org
 * last updated: june 7th, 2001.
 *
 * i'm too lazy to license this code.
 * do whatever you like.
 */

#include <stdio.h>
#include <fcntl.h>

#define PROGRAM "romjuice"
#define VERSION "v2.2"
#define DATE    "june 7th, 2001"
#define AUTHOR  "prez@lfx.org"

struct tbl_entry {
    int value;
    int bytes;
    char * string;
    int kanji;
    int linked;
    int swap;
    struct tbl_entry * next;
};

int free_tbl(struct tbl_entry * table) {
    struct tbl_entry * temp, * swap;
    temp = table->next;
    
    while ( temp->next ) {
        swap = temp->next;
        free(temp->string);
        free(temp);
        temp = swap;
    }
    
    table->next = 0;

    return(0);    
} 

int add_tbl_entry(struct tbl_entry * table, int value, int bytes, char * string, int kanji, int linked, int swap) {
    struct tbl_entry * temp;
    temp = table;
    
    while ( temp->next ) temp = temp->next;
    
    temp->next = (struct tbl_entry *) malloc(sizeof(struct tbl_entry));

    if ( ! temp->next ) {
        printf("Error: Out of memory.\n");
        return(-1);
    }
    
    temp = temp->next;
    
    temp->next = 0;
    temp->value = value;
    temp->bytes = bytes;
    temp->kanji = kanji;
    temp->linked = linked;
    temp->swap = swap;
    
    if ( string ) {
        temp->string = (char *) malloc(strlen(string)+1);
        if ( ! temp->string ) {
            printf("Error: Out of memory.\n");
            return(-1);
        }
        strcpy(temp->string,string);
    }

    else temp->string = NULL;

    return(0);
}

int whereis(char * string, char value) {
    int i;

    for ( i = 0 ; i < strlen(string) ; i++ ) {
        if ( string[i] == value ) return(i);
    }

    return(0);
}

int load_table(char * filename, struct tbl_entry * table) {
    FILE * fp;
    char buffer[1000];
    char * string, * newbuf;
    int value, bytes, linked, kanji;
    
    fp = fopen(filename,"r");

    if ( ! fp ) {
        printf("Error: Can't open table file.\n");
        return(-1);
    }
    
    while ( !feof(fp) ) {
        fgets(buffer, 1000, fp);

        if ( buffer[0] == '!' ) {
            if ( buffer[whereis(buffer,'\n')] ) buffer[whereis(buffer,'\n')] = '\0';
            sscanf(buffer,"!%x", &value);
            if ( add_tbl_entry(table,value,(strlen(buffer)-1)/2,NULL,0,0,value) < 0 ) return(-1);
        }
        
        else if ( whereis(buffer,'=') ) {
            
            if ( buffer[0] == '@' ) {
                string = (char *) strchr(buffer,'=') + 1;
                if ( string[whereis(string,'\n')] ) string[whereis(string,'\n')] = '\0';

                buffer[whereis(buffer,'=')] = '\0';

                sscanf(buffer,"@%x", &value);
                sscanf(string,"%i,%x", &linked, &kanji);
                
                if ( add_tbl_entry(table,value,(strlen(buffer)-1)/2,NULL,kanji,linked, 0) < 0 ) return(-1);
            }
            
            else if ( buffer[0] == '$' ) {
                string = (char *) strchr(buffer,'=') + 1;
                if ( string[whereis(string,'\n')] ) string[whereis(string,'\n')] = '\0';

                buffer[whereis(buffer,'=')] = '\0';

                sscanf(buffer,"$%x", &value);
                sscanf(string,"%i", &linked);
                
                if ( add_tbl_entry(table,value,(strlen(buffer)-1)/2,NULL,0,linked, 0) < 0 ) return(-1);
            }
            
            else {
                string = (char *) strchr(buffer,'=') + 1;
                if ( string[whereis(string,'\n')] ) string[whereis(string,'\n')] = '\0';

                buffer[whereis(buffer,'=')] = '\0';
                sscanf(buffer,"%x", &value);

                if ( add_tbl_entry(table,value,strlen(buffer)/2,string,0,0,0) < 0 ) return(-1);
            }
            
        }
    }

    return(0);
}

/* I know, I know :p */
void endian_swap(char * in, char * out) {
    out[0] = in[3];
    out[1] = in[2];
    out[2] = in[1];
    out[3] = in[0];
    out[4] = 0;
    out[5] = 0;
    out[6] = 0;
}

struct tbl_entry * resolve_value(struct tbl_entry * table, int value, int bytes) {
    struct tbl_entry * temp;
    temp = table;

    while ( temp->next ) {
        temp = temp->next;
        if ( temp->value == value && temp->bytes == bytes ) return(temp);
    }

    return(0);
}

int prints(FILE * fpout, char * string, int commenting) {
    int i;

    for ( i = 0 ; i < strlen(string) ; i++ ) {
        if ( string[i] == '\\' ) {
            if ( string[i+1] == '\\' ) i++, fprintf(fpout,"\\");
            else if ( string[i+1] == 'n' ) { 
                i++;
                fprintf(fpout,"\n");
                if ( commenting ) fprintf(fpout,"; ");
            }
            else if ( string[i+1] == 'r' ) { 
                i++;
                fprintf(fpout,"\n");
            }
            else fprintf(fpout,"\\");
        }
        
        else fprintf(fpout,"%c", string[i]);
    }

    return(0);
}

int scan_options(int argc, char ** argv, char * string) {
    int i;

    for ( i = 0 ; i < argc ; i++ ) {
        if ( ! strcmp(argv[i],string) ) return(i);
    }

    return(0);
}

int main(int argc, char ** argv) {
    struct tbl_entry tbl1, tbl2, *resolved, *kanji, *table;
    int err, fp, start, end, cur, check, *ptr, commenting = 1, i;
    unsigned char out_buffer[7];
    unsigned char in_buffer[4];
    unsigned char hacky_buffer[256];
    char *hex_format = 0;
    FILE * fpout;
    
    printf("%s %s, written by %s\n", PROGRAM, VERSION, AUTHOR);
    
    // check arguments.
    if ( argc < 6 ) exit(printf("usage: ./romjuice <rom.bin> <table.tbl> <start addr> <end addr> <output.txt>\n                  [options..]\n"));

    // init the first table entry, so stuff works.
    tbl1.value = 0;
    tbl1.string = 0;
    tbl1.next = 0;

    tbl2.value = 0;
    tbl2.string = 0;
    tbl2.next = 0;

    table = &tbl1;
   
    // Open files/Get values.

    // DOS based systems require the O_BINARY option, others don't.
#ifdef __MSDOS__
    if ( (fp = open(argv[1],O_RDONLY|O_BINARY)) < 1 ) exit(printf("Error opening ROM.\n"));
#else
    if ( (fp = open(argv[1],O_RDONLY)) < 1 ) exit(printf("Error opening ROM, \"%s\".\n", argv[1]));
#endif
    
    if ( (fpout = fopen(argv[5],"w")) == 0 ) exit(printf("Error opening output, \"%s\".\n", argv[5]));
    if ( load_table(argv[2],&tbl1) < 0 ) exit(printf("Error opening table file, \"%s\".\n", argv[2]));
    sscanf(argv[3],"%x",&start);
    sscanf(argv[4],"%x",&end);

    // Check for options.
    if ( scan_options(argc,argv,"-n") ) commenting = 0;
    if ( check = scan_options(argc,argv,"-h") ) {
        hex_format = (char *) malloc(strlen(argv[check+1]));
        strcpy(hex_format,argv[check+1]);
    }
    
    if ( check = scan_options(argc,argv,"-t") ) {
        if ( load_table(argv[check+1],&tbl2) < 0 ) exit(printf("Error opening second table file, \"%s\".\n", argv[check+1]));
    }
   
    // Do a little error checking.
    if ( start > end ) exit(printf("Error: Block ends before it starts\n"));

    // Let's get going. 
    fprintf(fpout,"; %s %s\n; written by %s\n", PROGRAM, VERSION, AUTHOR);
    fprintf(fpout,"; dumping from %X-%Xh\n", start, end); 
    fprintf(fpout,"; --------------------------\n; \n");
    printf("dumping from %X-%Xh into \"%s\".\n", start, end, argv[5]); 

    if ( commenting ) fprintf(fpout,"; ");
    
    for ( cur = start, lseek(fp,cur,SEEK_SET) ; cur < end + 1 ; cur+=(4-check), lseek(fp,cur,SEEK_SET) ) {
        read(fp,in_buffer,4);
        endian_swap(in_buffer,out_buffer);

        for ( check = 0 ; check < 4 ; check++ ) {
            ptr = (int *) &out_buffer[check];
            resolved = resolve_value(table,ptr[0],(4-check));

            if ( resolved ) {
  
                if ( resolved->swap && tbl2.next ) {
                    if ( table == &tbl1 ) table = &tbl2;
                    else table = &tbl1;
                    break;
                }
                
                else if ( resolved->kanji && resolved->linked ) {
                    lseek(fp,cur+resolved->bytes,SEEK_SET);
                    read(fp,hacky_buffer,resolved->linked);

                    for ( i = 0 ; i < resolved->linked ; i++ ) {
                        kanji = resolve_value(table,hacky_buffer[i]+resolved->kanji,2);

                        if ( kanji->string ) {
                            prints(fpout,kanji->string,commenting);
                        }

                        else {
                            if ( hex_format ) fprintf(fpout,hex_format,hacky_buffer[i]);
                            else fprintf(fpout,"<$%02X>",hacky_buffer[i]+resolved->kanji);
                        } 
                    }

                    cur+=resolved->linked;
                    break;
                }
                
                else if ( resolved->linked ) {
                    lseek(fp,cur,SEEK_SET);
                    read(fp,hacky_buffer,resolved->linked + resolved->bytes);

                    for ( i = 0 ; i < resolved->linked + resolved->bytes ; i++ ) {
                        if ( hex_format ) fprintf(fpout,hex_format,hacky_buffer[i]);
                        else fprintf(fpout,"<$%02X>",hacky_buffer[i]);
                    }

                    cur+=resolved->linked;
                    break;
                }                    
               
                else if ( resolved->string ) {
                    prints(fpout,resolved->string,commenting);
                    break;
                }

            }
                
            if ( check == 3 ) {
                if ( hex_format ) fprintf(fpout,hex_format,ptr[0]);
                else fprintf(fpout,"<$%02X>",ptr[0]);
                break;
            }
        }
        
    }

    fprintf(fpout,"\n");

    free_tbl(&tbl1);
    if ( tbl2.next ) free_tbl(&tbl2);
    return(0);
}
