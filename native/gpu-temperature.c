// Prints the temperature of the hottest GPU sensor of an Apple Silicon Mac in °C, followed by the sensor keys it read.
// Without arguments it searches all SMC keys for them, which takes most of a second; pass the keys to skip that.
// macOS only offers GPU temperatures through the SMC, which needs no admin rights for reading.
#include <IOKit/IOKitLib.h>
#include <stdio.h>
#include <string.h>

typedef struct {
    unsigned int key;
    unsigned char vers[6];
    unsigned char pLimitData[16];
    struct { unsigned int dataSize, dataType; unsigned char dataAttributes; } keyInfo;
    unsigned char result, status, data8;
    unsigned int data32;
    unsigned char bytes[32];
} SMCParam;

enum { READ_BYTES = 5, KEY_AT_INDEX = 8, KEY_INFO = 9 };

static io_connect_t smc;

static int call(unsigned char command, unsigned int key, unsigned int index, unsigned int size, SMCParam *out) {
    SMCParam in = {0};
    size_t outSize = sizeof(SMCParam);
    in.key = key;
    in.data8 = command;
    in.data32 = index;
    in.keyInfo.dataSize = size;
    memset(out, 0, sizeof(SMCParam));
    return IOConnectCallStructMethod(smc, 2, &in, sizeof(SMCParam), out, &outSize) == KERN_SUCCESS && out->result == 0;
}

static unsigned int fourcc(const char *code) {
    return (unsigned int) code[0] << 24 | (unsigned int) code[1] << 16 | (unsigned int) code[2] << 8 | (unsigned int) code[3];
}

static float hottest = 0;
static char keys[1024];

static void readSensor(unsigned int key) {
    SMCParam out;
    if (!call(KEY_INFO, key, 0, 0, &out) || out.keyInfo.dataType != fourcc("flt ")) return;
    if (!call(READ_BYTES, key, 0, out.keyInfo.dataSize, &out)) return;

    float value;
    memcpy(&value, out.bytes, sizeof value);
    if (value <= 0 || value >= 150) return;
    if (value > hottest) hottest = value;
    char name[6] = { ' ', (char) (key >> 24), (char) (key >> 16), (char) (key >> 8), (char) key, 0 };
    if (strlen(keys) + sizeof name < sizeof keys) strcat(keys, name);
}

int main(int argc, char **argv) {
    io_service_t service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSMC"));
    if (!service || IOServiceOpen(service, mach_task_self(), 0, &smc) != KERN_SUCCESS) return 1;

    if (argc > 1) {
        for (int arg = 1; arg < argc; arg++) {
            if (strlen(argv[arg]) == 4) readSensor(fourcc(argv[arg]));
        }
    } else {
        SMCParam out;
        if (!call(KEY_INFO, fourcc("#KEY"), 0, 0, &out) || !call(READ_BYTES, fourcc("#KEY"), 0, out.keyInfo.dataSize, &out)) return 1;
        unsigned int count = (unsigned int) out.bytes[0] << 24 | (unsigned int) out.bytes[1] << 16 | (unsigned int) out.bytes[2] << 8 | out.bytes[3];

        // GPU sensors are the keys starting with "Tg".
        for (unsigned int index = 0; index < count; index++) {
            if (call(KEY_AT_INDEX, 0, index, 0, &out) && (out.key >> 24) == 'T' && ((out.key >> 16) & 0xff) == 'g') readSensor(out.key);
        }
    }

    IOServiceClose(smc);
    if (hottest <= 0) return 1;
    printf("%.1f%s\n", hottest, keys);
    return 0;
}
