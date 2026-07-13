Standalone NES APU test assets

DPCM.bin
  The original game's 385-byte DPCM sample window used for internal fidelity
  testing. It is mapped as sample data only; no ROM image or CPU is loaded.

music-01-title.nat / music-02-menu.nat
  Offline development captures of writes to NES APU registers $4000-$4017,
  grouped into 60 Hz software frames. NAT1 is an audio-data trace format, not
  executable 6502 code and not a game ROM.

The browser runtime contains only an APU/DPCM signal generator. It contains no
6502 CPU, PPU, mapper, ROM loader, hidden emulator, or video output.

The adapted APU implementation comes from JSNES 2.1.0 under Apache-2.0; see
LICENSE-jsnes.txt.
