# 精选波表包 / Selected Wavetable Pack

只保留用户指定的四类音色：吉他、钢琴、贝斯、鼓机。

来源：WebAudioFontData 的浏览器可直接加载 `.js` wavetable 数据。

默认选择：
- 钢琴：`piano_acoustic_grand_fluidr3.js`
- 吉他：`guitar_clean_stratocaster.js`
- 贝斯：`bass_electric_finger_fluidr3.js`
- 鼓机：`drum_tr808_fluidr3/` TR-808 整套鼓声

注意：这里不打包 WebAudioFontPlayer GPL 代码，后续游戏内用自写 WebAudio/WASM 播放器读取这些数据。
