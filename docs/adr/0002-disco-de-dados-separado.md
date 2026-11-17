# 0002 — Disco de dados separado do disco de sistema

- Status: aceito
- Data: 2026-11-17
- Issue: 24K-111

## Contexto

A VM de produção (`tria-producao-vm`) tinha um único disco `pd-standard` de 30 GB.
Nele ficavam o SO, o Docker e os volumes (postgres, n8n, caddy).

Em 16/11, no e2-micro (1 GB), o n8n esgotou a memória e a VM foi reiniciada à
força mais de uma vez. Depois do resize para e2-medium, toda inicialização
passou a terminar num *kernel oops* do ext4, entre 2 e 3 minutos após o boot:

```
BUG: kernel NULL pointer dereference
RIP: ext4_mb_load_buddy_gfp+0xbc
Workqueue: writeback wb_workfn (flush-8:0)
```

Quando o writeback morre, todo processo que escreve em disco trava. O sshd fica
sem *banner*, o deploy via IAP trava e o app para de responder. `reset` não
resolve, porque o defeito está nos metadados de alocação do sistema de arquivos.

Além disso, o `machine_type` tinha sido alterado à mão no console. O Terraform
ainda declarava `e2-micro`, e o próximo `apply` faria a VM voltar a 1 GB.

## Decisão

1. **O disco de sistema passa a ser descartável.** Ele é recriado do zero pela
   imagem `debian-12`, como `pd-balanced` de 20 GB, e guarda só o SO, o Docker
   e as imagens.
2. **Os dados ficam num disco persistente separado** (`<prefixo>-dados`,
   `pd-balanced`, 30 GB, com `prevent_destroy`). O startup script monta esse
   disco em `/srv/dados` e faz um bind de `/srv/dados/var/lib/docker/volumes`
   em `/var/lib/docker/volumes`.
3. **O Docker não sobe sem os volumes.** Um drop-in com
   `RequiresMountsFor=/var/lib/docker/volumes` impede que o Postgres
   (`restart: unless-stopped`) inicialize um banco vazio no disco de sistema
   caso o disco de dados não monte.
4. **fsck antes da primeira montagem.** Na primeira montagem de cada VM, o script
   roda `e2fsck -fy` no disco de dados. Depois disso, o fstab usa
   `fs_passno=2`, e o fsck automático do boot passa a cuidar dele.
5. **Backup diário.** Uma `resource_policy` tira um snapshot do disco de dados
   todo dia às 06:00 UTC e mantém os últimos 7 dias.
6. **O `machine_type` passa a ser declarado no código** (`e2-medium`), e o
   drift acaba.

### Migração (uma vez)

O disco de dados nasce do snapshot `tria-producao-pre-fsck-20261117`, tirado
do disco antigo antes de qualquer reparo. Esse disco traz o sistema de arquivos
antigo inteiro. Só `var/lib/docker/volumes` é usado. O resto (SO antigo) fica
inerte e pode ser limpo depois. O `e2fsck -fy` do primeiro boot repara os
metadados corrompidos.

### Revisão da causa (mesmo dia)

Depois da recriação, a VM nova (imagem `debian-12-bookworm-v20261116`) repetiu
o mesmo oops aos 706s, durante o `docker pull` do deploy. Dessa vez o crash
foi no `flush-8:16`, o **disco de sistema recém-criado**, e não no disco de
dados. Um ext4 novo, formatado pela imagem, não tem metadados corrompidos.
Então a causa raiz é o kernel `6.1.0-55-cloud-amd64` (6.1.192), não o disco.
As inconsistências que o fsck achou no disco antigo eram consequência dos
crashes.

Isso bate com uma regressão relatada na série 6.1 stable: oops em
`ext4_mb_load_buddy_gfp` ligado ao backport da conversão
`bd_buddy_page → bd_buddy_folio`.

Decisão adicional: a imagem passa de `debian-12` para **`debian-13`** (trixie,
kernel 6.12). O disco de dados separado continua valendo. Foi graças a ele que
a troca de imagem não arriscou os dados.

## Consequências

- Recriar a VM, trocar a imagem ou o tipo de máquina não toca mais nos dados.
  Se o disco de sistema corromper de novo, basta forçar a recriação da
  instância.
- O free tier de disco (30 GB `pd-standard`) deixa de valer. Com 20 + 30 GB
  `pd-balanced` e os snapshots diários, o custo de disco sobe cerca de
  US$ 5–6 por mês. O e2-medium já tinha saído do free tier.
- O disco de sistema antigo é apagado na troca da instância
  (`auto_delete`). O snapshot `tria-producao-pre-fsck-20261117` é a cópia de
  segurança dele.
