/** The running beat counter (beats since the start). The vessel shader reads it as a uniform, the ECG trace reads it as a number. */
export const beat = { value: 0.1 }

/** Distance blood travels in one beat in the drawn wave (m). A real pulse wave is several times longer, this one is made to be seen. */
export const WAVELENGTH = 1.25
