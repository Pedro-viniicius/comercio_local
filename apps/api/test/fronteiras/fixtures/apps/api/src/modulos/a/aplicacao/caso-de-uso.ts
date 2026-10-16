// Controle: aplicação importa domínio, núcleo e framework.
import { Injectable } from '@nestjs/common';
import { nucleo } from '../../../compartilhado/nucleo.ts';
import { criar } from '../dominio/regra.ts';

export const CasoDeUso = Injectable;
export const executar = (id: string): unknown => criar(`${nucleo}:${id}`);
