# Catálogo de passeios

Site estático em HTML, CSS e JavaScript. `activities.json` é a fonte de dados; não há banco de dados.

## Lugares e atividades

O arquivo contém uma lista de **lugares**. Cada lugar mantém seu `id`, informações práticas, fontes e uma lista `activities` de atividades independentes. Uma visita comum é uma atividade `visit`; uma programação temporária é uma atividade `event`.

Campos de cada atividade:

- `id`: identificador único e permanente em todo o catálogo.
- `title`, `description`: título e descrição completa em português.
- `url`: fonte verificável.
- `checkedAt`: data em que a fonte foi consultada.
- `updatedAt`: data/hora da última alteração relevante do conteúdo.
- `kind`: `visit` ou `event`.
- `startsAt`, `endsAt`: datas ISO, ou `null` quando não se aplicam ou ainda não foram confirmadas.

Os lugares aparecem por `updatedAt`, do mais recente ao mais antigo. Uma nova atividade também atualiza o `updatedAt` do lugar. A simples conferência de uma fonte (`checkedAt`) não deve alterar essa ordem.

## Histórico preservado

Novas programações são acrescentadas ao lugar existente, sem duplicá-lo. Não remova atividades encerradas, não reutilize identificadores e não apague lugares antigos. Correções factuais podem atualizar os campos existentes, preservando identificadores e metadados; alterações relevantes recebem um novo `updatedAt`.

As visitas do catálogo anterior foram convertidas para atividades com o identificador `ID_DO_LUGAR--visit`. Os horários iniciais de atualização foram recuperados do histórico Git. Nenhum evento novo foi inventado durante a migração.

Favoritos e atividades concluídas são dados locais do navegador, não publicados no repositório. Visitas antigas são migradas somente para a atividade de visita comum: não concluem automaticamente novos eventos do mesmo lugar. O histórico pode ser desfeito individualmente.

## Publicação

As rotinas de pesquisa modificam somente `activities.json`, preservando o restante do site. A publicação deve validar identificadores, datas, atividades anteriores e alterações concorrentes antes de gravar. Fontes inacessíveis não equivalem a ausência de programação; datas de eventos precisam de confirmação antes de serem apresentadas como atuais.
