import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGrabReleaseToMediaRequest1790000000100
  implements MigrationInterface
{
  name = 'AddGrabReleaseToMediaRequest1790000000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD "grabReleaseGuid" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD "grabReleaseIndexerId" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD "grabEpisodeId" integer`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP COLUMN "grabEpisodeId"`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP COLUMN "grabReleaseIndexerId"`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP COLUMN "grabReleaseGuid"`
    );
  }
}
