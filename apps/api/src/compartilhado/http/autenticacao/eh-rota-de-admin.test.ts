import 'reflect-metadata';
import { Controller, Get, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ehRotaDeAdmin } from './autenticado.guard.ts';

@Controller('v1/admin')
class AdminDeclarado {
  @Get('x')
  x() {
    return 1;
  }
}

@Controller('V1/ADMIN/Painel')
class AdminEmMaiusculas {
  @Get()
  x() {
    return 1;
  }
}

@Controller('v1/administrativo')
class ParecidoComAdmin {
  @Get()
  x() {
    return 1;
  }
}

@Controller('v1/contas')
class ContasComMetodoAdmin {
  @Get('admin')
  x() {
    return 1;
  }
}

@Controller('admin')
class SemPrefixoNosMetadados {
  @Get('y')
  y() {
    return 1;
  }
}

function contexto(classe: new () => object, metodo: string, req: object = {}): ExecutionContext {
  const proto = classe.prototype as Record<string, () => unknown>;
  return {
    getClass: () => classe,
    getHandler: () => proto[metodo],
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('ehRotaDeAdmin (S110)', () => {
  it('reconhece /v1/admin pelo caminho declarado no controller e no método', () => {
    expect(ehRotaDeAdmin(contexto(AdminDeclarado, 'x'))).toBe(true);
  });

  it('não diferencia maiúsculas no caminho declarado', () => {
    expect(ehRotaDeAdmin(contexto(AdminEmMaiusculas, 'x'))).toBe(true);
  });

  it('não confunde com prefixos parecidos nem com `admin` fora do começo', () => {
    expect(ehRotaDeAdmin(contexto(ParecidoComAdmin, 'x'))).toBe(false);
    expect(ehRotaDeAdmin(contexto(ContasComMetodoAdmin, 'x'))).toBe(false);
  });

  it('reconhece pela rota casada quando o prefixo vem do `setGlobalPrefix`', () => {
    expect(ehRotaDeAdmin(contexto(SemPrefixoNosMetadados, 'y'))).toBe(false);
    expect(
      ehRotaDeAdmin(
        contexto(SemPrefixoNosMetadados, 'y', { baseUrl: '', route: { path: '/v1/admin/y' } }),
      ),
    ).toBe(true);
    expect(
      ehRotaDeAdmin(
        contexto(SemPrefixoNosMetadados, 'y', { baseUrl: '/V1', route: { path: '/ADMIN/y' } }),
      ),
    ).toBe(true);
  });
});
