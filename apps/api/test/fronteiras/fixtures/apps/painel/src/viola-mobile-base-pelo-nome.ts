// O painel não declara o mobile-base, então o import não resolve: a regra o reconhece pelo nome.
// @ts-expect-error pacote que o painel não tem
import { mobileBase } from '@bairrin/mobile-base';

export const viola: unknown = mobileBase;
